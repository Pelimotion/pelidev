"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, RefreshCw, Loader2, Radio, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { v4 as uuidv4 } from "uuid";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

function TransmitirContent() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const senderIdRef = useRef<string>(uuidv4());
  const isNegotiating = useRef(false);
  const batchedCandidates = useRef<RTCIceCandidateInit[]>([]);
  const candidateTimer = useRef<NodeJS.Timeout | null>(null);

  const [status, setStatus] = useState("Iniciando câmera...");
  const [isConnected, setIsConnected] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [stream, setStream] = useState<MediaStream | null>(null);

  const sendSignal = async (room: string, payload: unknown) => {
    try {
      await fetch(`https://ntfy.sh/pelidev-${room}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("[Signaling] Erro ao enviar:", e);
    }
  };

  const startCamera = async (mode: "environment" | "user") => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    // 1. Tenta alta resolução; 2. Fallback resiliente para qualquer câmera móvel
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        },
        audio: false,
      });

      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch(e => console.warn("Auto-play prevented:", e));
      }
      return newStream;
    } catch (err) {
      console.warn("Tentando fallback de câmera sem restrições de resolução:", err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode },
          audio: false,
        });
        setStream(fallbackStream);
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          videoRef.current.play().catch(e => console.warn("Auto-play prevented:", e));
        }
        return fallbackStream;
      } catch (fatal) {
        console.error("Erro ao acessar câmera do celular:", fatal);
        setStatus("Câmera bloqueada. Permita o acesso nas configurações do navegador.");
        return null;
      }
    }
  };

  const sendOffer = async (pc: RTCPeerConnection, room: string) => {
    if (isNegotiating.current || pc.connectionState === "connected") return;
    try {
      isNegotiating.current = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignal(room, {
        senderId: senderIdRef.current,
        type: "offer",
        offer: offer,
      });
      setStatus("Sinal enviado. Conectando com o PC...");
    } catch (e) {
      console.error("[WebRTC] Erro ao criar offer:", e);
    } finally {
      isNegotiating.current = false;
    }
  };

  const initWebRTC = async (currentStream: MediaStream) => {
    if (!roomId) {
      setStatus("Sem código de sala.");
      return;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    currentStream.getTracks().forEach((track) => {
      pc.addTrack(track, currentStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        batchedCandidates.current.push(event.candidate.toJSON());
        if (!candidateTimer.current) {
          candidateTimer.current = setTimeout(() => {
            sendSignal(roomId, {
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
      console.log("[WebRTC Sender] Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatus("Transmitindo ao vivo para o PC");
        setIsConnected(true);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setStatus("Conexão perdida. Tentando reconectar...");
        setIsConnected(false);
      }
    };

    // Conectar WebSocket no ntfy.sh
    const ws = new WebSocket(`wss://ntfy.sh/pelidev-${roomId}/ws`);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("Aguardando receptor...");
      // Envia a oferta inicial
      await new Promise((r) => setTimeout(r, 400));
      sendOffer(pc, roomId);
    };

    ws.onmessage = async (event) => {
      try {
        const wrapper = JSON.parse(event.data);
        if (wrapper.event !== "message" || !wrapper.message) return;

        const data = JSON.parse(wrapper.message);
        if (data.senderId === senderIdRef.current) return; // Ignora eco próprio

        // Receptor anunciou que acabou de abrir: reenvia offer se não conectado
        if (data.type === "receiver-ready" && pc.connectionState !== "connected") {
          console.log("[WebRTC Sender] Receptor pronto! Enviando offer...");
          sendOffer(pc, roomId);
        } else if (data.type === "answer" && data.answer) {
          console.log("[WebRTC Sender] Answer recebido com sucesso!");
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

          // Descarrega candidatos ICE acumulados
          while (candidateQueue.current.length > 0) {
            const cand = candidateQueue.current.shift()!;
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.error);
          }
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
        console.error("[WebRTC Sender] Erro:", err);
      }
    };

    ws.onclose = () => {
      setStatus("Desconectado.");
      setIsConnected(false);
    };
  };

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const initialStream = await startCamera(facingMode);
      if (mounted && initialStream) {
        initWebRTC(initialStream);
      }
    };

    setup();

    return () => {
      mounted = false;
      wsRef.current?.close();
      pcRef.current?.close();
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const toggleCamera = async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);

    const newStream = await startCamera(newMode);

    if (newStream && pcRef.current) {
      const videoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
    }
  };

  if (!roomId) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0A0A0B] text-white p-4">
        <div className="bg-white/5 border border-white/10 p-8 rounded-3xl max-w-sm text-center space-y-4 shadow-2xl">
          <Camera size={48} className="mx-auto text-indigo-400" />
          <h2 className="text-xl font-bold">Nenhuma Sala Informada</h2>
          <p className="text-gray-400 text-sm">Escaneie o QR Code no computador ou use o aplicativo Android para parear automaticamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#0A0A0B] text-white flex flex-col relative overflow-hidden">
      {/* Header UI Overlay */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-6 left-6 right-6 z-10 flex justify-between items-start"
      >
        <div className="bg-black/70 border border-white/10 p-3 px-5 rounded-2xl backdrop-blur-xl flex flex-col shadow-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Radio size={16} className={isConnected ? "text-green-500 animate-pulse" : "text-yellow-500"} />
            <span className="text-sm font-bold tracking-wide">
              {isConnected ? "AO VIVO NO PC" : "CONECTANDO"}
            </span>
          </div>
          <span className="text-xs text-gray-300 font-mono">{status}</span>
          <span className="text-[10px] text-gray-500 font-mono mt-0.5">SALA: {roomId}</span>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleCamera}
          className="bg-black/70 border border-white/10 p-4 rounded-full backdrop-blur-xl shadow-2xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <RefreshCw size={24} className="text-gray-200" />
        </motion.button>
      </motion.div>

      {/* Video View */}
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        {!stream && <Loader2 size={48} className="text-indigo-500 animate-spin absolute z-0" />}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-700 ${stream ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </div>
  );
}

export default function TransmitirPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-[#0A0A0B] flex items-center justify-center">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      }
    >
      <TransmitirContent />
    </Suspense>
  );
}
