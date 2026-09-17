"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import QRCode from "react-qr-code";
import { v4 as uuidv4 } from "uuid";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  MonitorCheck,
  WifiOff,
  Maximize2,
  Minimize2,
  FlipHorizontal,
  RotateCw,
  Sliders,
  Share2,
  Check,
  Tv,
  PictureInPicture2,
  Ratio,
  RotateCcw,
} from "lucide-react";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

function ReceberContent() {
  const searchParams = useSearchParams();
  const isClean = searchParams.get("clean") === "1";
  const customRoom = searchParams.get("roomId");

  // Parâmetros de URL opcionais para OBS Browser Source
  const initialMirror = searchParams.get("mirror") === "1";
  const initialRotate = parseInt(searchParams.get("rotate") || "0", 10);
  const initialFit = searchParams.get("fit") === "cover" ? "cover" : "contain";

  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "waiting" | "connected" | "disconnected">("connecting");
  const [videoResolution, setVideoResolution] = useState<string>("");
  const [copiedObs, setCopiedObs] = useState(false);

  // Controles de Imagem e Stream
  const [isMirrored, setIsMirrored] = useState(initialMirror);
  const [rotation, setRotation] = useState<number>(initialRotate);
  const [fitMode, setFitMode] = useState<"contain" | "cover">(initialFit);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [saturation, setSaturation] = useState<number>(100);
  const [showFilters, setShowFilters] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const senderIdRef = useRef<string>(uuidv4());
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const batchedCandidates = useRef<RTCIceCandidateInit[]>([]);
  const candidateTimer = useRef<NodeJS.Timeout | null>(null);

  const sendSignal = async (room: string, payload: unknown) => {
    try {
      await fetch(`https://ntfy.sh/pelidev-${room}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("[Signaling] Erro:", e);
    }
  };

  // Autohide de controles após inatividade
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (!showFilters) setShowControls(false);
    }, 3500);
  };

  useEffect(() => {
    const id = customRoom || uuidv4().slice(0, 6);
    setRoomId(id);
    setStatus("waiting");

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      console.log("[WebRTC] Stream track recebido!", event.streams);
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        videoRef.current.play().catch(console.error);
        setStatus("connected");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        batchedCandidates.current.push(event.candidate.toJSON());
        if (!candidateTimer.current) {
          candidateTimer.current = setTimeout(() => {
            sendSignal(id, {
              senderId: senderIdRef.current,
              type: "candidates-batch",
              candidates: batchedCandidates.current,
            });
            batchedCandidates.current = [];
            candidateTimer.current = null;
          }, 1000);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("connected");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setStatus("disconnected");
      }
    };

    // Conectar WebSocket ntfy.sh
    const ws = new WebSocket(`wss://ntfy.sh/pelidev-${id}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Avisa imediatamente que o receptor está pronto e aguardando
      sendSignal(id, {
        senderId: senderIdRef.current,
        type: "receiver-ready",
      });
    };

    ws.onmessage = async (event) => {
      try {
        const wrapper = JSON.parse(event.data);
        if (wrapper.event !== "message" || !wrapper.message) return;

        const data = JSON.parse(wrapper.message);
        if (data.senderId === senderIdRef.current) return; // Ignora próprio eco

        if (data.type === "offer" && data.offer) {
          console.log("[WebRTC] Offer recebido!");
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

          // Descarrega candidatos pendentes
          while (candidateQueue.current.length > 0) {
            const cand = candidateQueue.current.shift()!;
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.error);
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendSignal(id, {
            senderId: senderIdRef.current,
            type: "answer",
            answer: answer,
          });
        } else if (data.type === "candidate" && data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
          } else {
            candidateQueue.current.push(data.candidate);
          }
        } else if (data.type === "candidates-batch" && data.candidates) {
          for (const c of data.candidates) {
            if (pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
            } else {
              candidateQueue.current.push(c);
            }
          }
        }
      } catch (err) {
        console.error("[WebRTC] Erro no sinal:", err);
      }
    };

    // Heartbeat: anuncia que o receptor está aberto a cada 3s caso o transmissor entre depois
    const readyInterval = setInterval(() => {
      if (pc.connectionState !== "connected") {
        sendSignal(id, {
          senderId: senderIdRef.current,
          type: "receiver-ready",
        });
      }
    }, 3000);

    return () => {
      clearInterval(readyInterval);
      ws.close();
      pc.close();
    };
  }, [customRoom]);

  // Captura resolução do vídeo assim que os metadados carregarem
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setVideoResolution(`${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error("Erro no PiP:", err);
    }
  };

  const rotateVideo = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const resetFilters = () => {
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setIsMirrored(false);
    setRotation(0);
  };

  // URL para transmissão (QR Code)
  const transmitUrl = roomId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/transmitir?roomId=${roomId}`
    : "";

  // URL otimizada para OBS Browser Source
  const obsUrl = roomId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/receber?roomId=${roomId}&clean=1${
        isMirrored ? "&mirror=1" : ""
      }${rotation > 0 ? `&rotate=${rotation}` : ""}${fitMode === "cover" ? "&fit=cover" : ""}`
    : "";

  const copyObsLink = () => {
    navigator.clipboard.writeText(obsUrl);
    setCopiedObs(true);
    setTimeout(() => setCopiedObs(false), 2500);
  };

  // Estilo de transformação do vídeo (Espelhamento, Rotação e Filtros)
  const videoTransformStyle = {
    transform: `rotate(${rotation}deg) scaleX(${isMirrored ? -1 : 1})`,
    filter: `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`,
    transition: "transform 0.3s ease, filter 0.2s ease",
  };

  // MODO LIMPO (Direto para OBS Browser Source sem UI)
  if (isClean) {
    return (
      <div className="w-screen h-screen bg-transparent overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleLoadedMetadata}
          style={videoTransformStyle}
          className={`w-full h-full ${fitMode === "cover" ? "object-cover" : "object-contain"} ${
            status !== "connected" ? "opacity-0" : "opacity-100"
          }`}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden select-none"
    >
      {/* Background gradients */}
      <div className="absolute top-[10%] left-[20%] w-[40%] h-[40%] bg-purple-600/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[10%] right-[20%] w-[40%] h-[40%] bg-blue-600/10 blur-[140px] rounded-full pointer-events-none" />

      {/* Top Bar Header */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-6 left-6 right-6 z-20 flex justify-between items-center pointer-events-auto"
          >
            {/* Status Pill */}
            <div className="bg-black/60 border border-white/10 p-3 px-5 rounded-2xl backdrop-blur-xl flex items-center gap-3 shadow-2xl">
              <div
                className={`p-2 rounded-full ${
                  status === "connected"
                    ? "bg-green-500/20 text-green-400"
                    : status === "disconnected"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {status === "connected" ? (
                  <MonitorCheck size={18} />
                ) : status === "disconnected" ? (
                  <WifiOff size={18} />
                ) : (
                  <Loader2 size={18} className="animate-spin" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold tracking-wide text-gray-200">Receptor PeliDev</h1>
                  {videoResolution && (
                    <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-gray-300 font-mono">
                      {videoResolution}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 font-mono mt-0.5">SALA: {roomId || "..."}</p>
              </div>
            </div>

            {/* OBS Quick Export Button */}
            <button
              onClick={copyObsLink}
              className="bg-indigo-600/80 hover:bg-indigo-600 border border-indigo-400/30 p-3 px-5 rounded-2xl backdrop-blur-xl flex items-center gap-2.5 text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all cursor-pointer"
            >
              {copiedObs ? <Check size={18} className="text-green-300" /> : <Tv size={18} />}
              <span>{copiedObs ? "Link OBS Copiado!" : "Copiar Link para OBS"}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Video Surface */}
      <div
        onDoubleClick={toggleFullscreen}
        className="relative w-full max-w-6xl aspect-video bg-black/60 border border-white/10 rounded-3xl overflow-hidden flex items-center justify-center shadow-2xl backdrop-blur-sm z-10"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleLoadedMetadata}
          style={videoTransformStyle}
          className={`w-full h-full ${fitMode === "cover" ? "object-cover" : "object-contain"} ${
            status !== "connected" ? "hidden" : ""
          }`}
        />

        {/* QR Code de Pareamento Instantâneo quando aguardando */}
        {status !== "connected" && roomId && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center space-y-6 text-center p-8 max-w-md"
          >
            <div className="p-4 bg-white rounded-3xl shadow-2xl ring-4 ring-white/10">
              <QRCode value={transmitUrl} size={210} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-gray-100">Pareamento Automático</h2>
              <p className="text-sm text-gray-400">
                Aponte a câmera do celular ou toque em <strong>Escanear QR Code</strong> no app Android para conectar sem digitar nada!
              </p>
              <div className="mt-3 p-3 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
                <span className="text-xs text-gray-400 font-mono">Sala: {roomId}</span>
                <span className="text-xs text-indigo-400 font-mono">ntfy.sh/pelidev-{roomId}</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Painel Flutuante de Ajustes de Imagem (Sliders) */}
        <AnimatePresence>
          {showFilters && status === "connected" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="absolute bottom-24 right-6 bg-black/80 border border-white/15 p-6 rounded-3xl backdrop-blur-2xl shadow-2xl z-30 w-80 space-y-5"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 className="text-sm font-bold text-gray-200">Ajustes de Imagem</h3>
                <button
                  onClick={resetFilters}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw size={12} /> Resetar
                </button>
              </div>

              {/* Brilho */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>Brilho</span>
                  <span className="font-mono">{brightness}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Contraste */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>Contraste</span>
                  <span className="font-mono">{contrast}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Saturação */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>Saturação</span>
                  <span className="font-mono">{saturation}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={saturation}
                  onChange={(e) => setSaturation(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dock Flutuante de Controle Estúdio (Apenas quando conectado) */}
        <AnimatePresence>
          {showControls && status === "connected" && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="absolute bottom-6 z-20 flex items-center gap-2 bg-black/60 border border-white/10 p-2.5 px-4 rounded-2xl backdrop-blur-xl shadow-2xl"
            >
              {/* Espelhar Horizontalmente */}
              <button
                onClick={() => setIsMirrored(!isMirrored)}
                title="Espelhar Imagem (Flip Horizontal)"
                className={`p-3 rounded-xl transition-all cursor-pointer ${
                  isMirrored ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25" : "bg-white/5 hover:bg-white/10 text-gray-300"
                }`}
              >
                <FlipHorizontal size={18} />
              </button>

              {/* Girar 90 graus */}
              <button
                onClick={rotateVideo}
                title="Girar 90 graus"
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-all cursor-pointer"
              >
                <RotateCw size={18} />
              </button>

              {/* Ajustar / Preencher Tela */}
              <button
                onClick={() => setFitMode(fitMode === "contain" ? "cover" : "contain")}
                title={fitMode === "contain" ? "Preencher Tela (Cover)" : "Ajustar Proporção (Contain)"}
                className={`p-3 rounded-xl transition-all cursor-pointer ${
                  fitMode === "cover" ? "bg-indigo-600 text-white" : "bg-white/5 hover:bg-white/10 text-gray-300"
                }`}
              >
                <Ratio size={18} />
              </button>

              {/* Abrir Sliders de Filtro */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                title="Ajustes de Cor e Luz"
                className={`p-3 rounded-xl transition-all cursor-pointer ${
                  showFilters ? "bg-indigo-600 text-white" : "bg-white/5 hover:bg-white/10 text-gray-300"
                }`}
              >
                <Sliders size={18} />
              </button>

              <div className="w-[1px] h-6 bg-white/10 mx-1" />

              {/* Picture in Picture */}
              <button
                onClick={togglePiP}
                title="Picture-in-Picture (Janela Flutuante)"
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-all cursor-pointer"
              >
                <PictureInPicture2 size={18} />
              </button>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                title="Tela Cheia (F)"
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-all cursor-pointer"
              >
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Dica para Streamers no rodapé */}
      <div className="mt-6 text-xs text-gray-500 z-10 flex items-center gap-2">
        <span>💡 Dica para OBS: Cole o <strong>Link para OBS</strong> como fonte Navegador (1920x1080) e desmarque "Desativar quando não estiver visível".</span>
      </div>
    </div>
  );
}

export default function ReceberPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-[#0A0A0B] flex items-center justify-center">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      }
    >
      <ReceberContent />
    </Suspense>
  );
}
