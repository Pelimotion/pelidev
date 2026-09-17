"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, RefreshCw, Loader2, Radio } from "lucide-react";
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
      console.error("[Signaling] Erro ao enviar sinal:", e);
    }
  };

  const startCamera = async (mode: "environment" | "user") => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }

      return newStream;
    } catch (err) {
      console.error("Erro ao acessar câmera:", err);
      setStatus("Erro ao acessar câmera.");
      return null;
    }
  };

  const initWebRTC = async (currentStream: MediaStream) => {
    if (!roomId) {
      setStatus("Sem roomId na URL.");
      return;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    currentStream.getTracks().forEach((track) => {
      pc.addTrack(track, currentStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(roomId, {
          senderId: senderIdRef.current,
          type: "candidate",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC Sender] Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatus("Transmitindo ao vivo");
        setIsConnected(true);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setStatus("Conexão perdida. Tentando reconectar...");
        setIsConnected(false);
      }
    };

    // Conectar WebSocket no ntfy.sh
    const wsUrl = `wss://ntfy.sh/pelidev-${roomId}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("Negociando conexão...");

      // Pequena pausa para garantir que o canal de subscrição está pronto
      await new Promise((r) => setTimeout(r, 400));

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignal(roomId, {
          senderId: senderIdRef.current,
          type: "offer",
          offer: offer,
        });
      } catch (e) {
        console.error("[WebRTC] Erro ao criar offer:", e);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const wrapper = JSON.parse(event.data);
        if (wrapper.event !== "message" || !wrapper.message) return;

        const data = JSON.parse(wrapper.message);
        if (data.senderId === senderIdRef.current) return; // Ignora próprio eco

        if (data.type === "answer" && data.answer) {
          console.log("[WebRTC] Answer recebido!");
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

          // Descarrega candidatos
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
        }
      } catch (err) {
        console.error("[WebRTC Sender] Erro ao processar mensagem:", err);
      }
    };

    ws.onclose = () => {
      setStatus("Desconectado do servidor.");
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
      <div className="flex items-center justify-center h-screen bg-[#0A0A0B] text-white">
        <div className="bg-white/5 border border-white/10 p-8 rounded-2xl max-w-sm text-center space-y-4">
          <Camera size={48} className="mx-auto text-gray-400" />
          <h2 className="text-xl font-semibold">Sala Inválida</h2>
          <p className="text-gray-400 text-sm">Escaneie o QR Code no computador para iniciar a transmissão.</p>
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
        <div className="bg-black/60 border border-white/10 p-3 px-5 rounded-2xl backdrop-blur-xl flex flex-col shadow-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Radio size={16} className={isConnected ? "text-red-500 animate-pulse" : "text-yellow-500"} />
            <span className="text-sm font-bold tracking-wide">{isConnected ? "AO VIVO" : "CONECTANDO"}</span>
          </div>
          <span className="text-xs text-gray-400 font-mono">{status}</span>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleCamera}
          className="bg-black/60 border border-white/10 p-4 rounded-full backdrop-blur-xl shadow-2xl hover:bg-white/10 transition-colors"
        >
          <RefreshCw size={24} className="text-gray-200" />
        </motion.button>
      </motion.div>

      {/* Video View */}
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        {!stream && <Loader2 size={48} className="text-blue-500 animate-spin absolute z-0" />}
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
