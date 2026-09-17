"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import QRCode from "react-qr-code";
import { v4 as uuidv4 } from "uuid";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, MonitorCheck, WifiOff } from "lucide-react";

function ReceberContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "waiting" | "connected" | "disconnected">("connecting");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const searchParams = useSearchParams();
  const isClean = searchParams.get("clean") === "1";

  useEffect(() => {
    const id = uuidv4().slice(0, 6);
    setRoomId(id);
    setStatus("waiting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?roomId=${id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const configuration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
    const pc = new RTCPeerConnection(configuration);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setStatus("connected");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setStatus("disconnected");
      } else if (pc.connectionState === "connected") {
        setStatus("connected");
      }
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", answer }));
      } else if (data.type === "candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    };

    return () => {
      ws.close();
      pc.close();
    };
  }, []);

  const transmitUrl = roomId ? `${window.location.origin}/transmitir?roomId=${roomId}` : "";

  // Modo Limpo (para OBS Browser Source)
  if (isClean) {
    return (
      <div className="w-screen h-screen bg-transparent overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-cover ${status !== "connected" ? 'hidden' : ''}`}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-[10%] left-[20%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />
      
      {!isClean && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-6 left-6 z-10 bg-white/5 border border-white/10 p-4 rounded-2xl backdrop-blur-xl shadow-2xl"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${status === 'connected' ? 'bg-green-500/20 text-green-400' : status === 'disconnected' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
              {status === 'connected' ? <MonitorCheck size={20} /> : status === 'disconnected' ? <WifiOff size={20} /> : <Loader2 size={20} className="animate-spin" />}
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide text-gray-200">Receptor Pelidev</h1>
              <p className="text-xs text-gray-400 font-mono mt-0.5">SALA: {roomId || "..."}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Video Container */}
      <motion.div 
        layout
        className={`relative w-full max-w-5xl aspect-video bg-black/40 border border-white/10 rounded-3xl overflow-hidden flex items-center justify-center shadow-2xl backdrop-blur-sm z-10 transition-all duration-700`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain ${status !== 'connected' ? 'hidden' : ''}`}
        />
        
        {status !== 'connected' && roomId && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center space-y-8"
          >
            <div className="p-4 bg-white rounded-2xl shadow-2xl ring-4 ring-white/10">
              <QRCode value={transmitUrl} size={220} />
            </div>
            <div className="text-center space-y-2 max-w-md">
              <h2 className="text-xl font-semibold text-gray-200">Aguardando câmera...</h2>
              <p className="text-sm text-gray-400">
                Abra o app no celular ou escaneie este código para parear automaticamente via rede local.
              </p>
              <div className="mt-4 p-3 bg-white/5 rounded-lg border border-white/10">
                <p className="text-xs text-gray-500 font-mono break-all">{transmitUrl}</p>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

export default function ReceberPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#0A0A0B] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    }>
      <ReceberContent />
    </Suspense>
  );
}
