"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import QRCode from "react-qr-code";
import { v4 as uuidv4 } from "uuid";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, MonitorCheck, WifiOff } from "lucide-react";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

function ReceberContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "waiting" | "connected" | "disconnected">("connecting");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const senderIdRef = useRef<string>(uuidv4());
  
  const searchParams = useSearchParams();
  const isClean = searchParams.get("clean") === "1";
  const customRoom = searchParams.get("roomId");

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

  useEffect(() => {
    const id = customRoom || uuidv4().slice(0, 6);
    setRoomId(id);
    setStatus("waiting");

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      console.log("[WebRTC] Track recebido!", event.streams);
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        videoRef.current.play().catch((e) => console.log("[Video] Autoplay note:", e));
        setStatus("connected");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(id, {
          senderId: senderIdRef.current,
          type: "candidate",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatus("connected");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setStatus("disconnected");
      }
    };

    // Conectar WebSocket ntfy.sh
    const wsUrl = `wss://ntfy.sh/pelidev-${id}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const wrapper = JSON.parse(event.data);
        if (wrapper.event !== "message" || !wrapper.message) return;

        const data = JSON.parse(wrapper.message);
        if (data.senderId === senderIdRef.current) return; // Ignora eco próprio

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
        }
      } catch (err) {
        console.error("[WebRTC] Erro ao processar sinal:", err);
      }
    };

    return () => {
      ws.close();
      pc.close();
    };
  }, [customRoom]);

  const transmitUrl = roomId ? `${typeof window !== "undefined" ? window.location.origin : ""}/transmitir?roomId=${roomId}` : "";

  // Modo Limpo (para OBS Browser Source)
  if (isClean) {
    return (
      <div className="w-screen h-screen bg-transparent overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${status !== "connected" ? "hidden" : ""}`}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-[10%] left-[20%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Header Info */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-6 left-6 z-10 bg-white/5 border border-white/10 p-4 rounded-2xl backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center gap-3">
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
              <MonitorCheck size={20} />
            ) : status === "disconnected" ? (
              <WifiOff size={20} />
            ) : (
              <Loader2 size={20} className="animate-spin" />
            )}
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-gray-200">Receptor PeliDev</h1>
            <p className="text-xs text-gray-400 font-mono mt-0.5">SALA: {roomId || "..."}</p>
          </div>
        </div>
      </motion.div>

      {/* Video Container */}
      <motion.div
        layout
        className="relative w-full max-w-5xl aspect-video bg-black/40 border border-white/10 rounded-3xl overflow-hidden flex items-center justify-center shadow-2xl backdrop-blur-sm z-10"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain ${status !== "connected" ? "hidden" : ""}`}
        />

        {status !== "connected" && roomId && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center space-y-6 text-center p-6"
          >
            <div className="p-4 bg-white rounded-2xl shadow-2xl ring-4 ring-white/10">
              <QRCode value={transmitUrl} size={200} />
            </div>
            <div className="space-y-2 max-w-md">
              <h2 className="text-xl font-bold text-gray-100">Aguardando Câmera</h2>
              <p className="text-sm text-gray-400">
                Abra o app no celular Android com a sala <span className="text-indigo-400 font-mono font-bold">{roomId}</span> ou escaneie este QR Code com o navegador.
              </p>
              <div className="mt-3 p-2.5 bg-white/5 rounded-xl border border-white/10">
                <p className="text-xs text-gray-400 font-mono select-all break-all">{transmitUrl}</p>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* OBS Help Footer */}
      <div className="mt-6 text-xs text-gray-500 z-10 flex items-center gap-2">
        <span>Para usar no OBS Studio como Câmera Virtual: adicione uma fonte <strong>Navegador</strong> com o link acima e adicione <code>&clean=1</code>.</span>
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
