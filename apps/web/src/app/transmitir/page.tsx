"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, RefreshCw, Loader2, Radio } from "lucide-react";
import { motion } from "framer-motion";

function TransmitirContent() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const [status, setStatus] = useState("Iniciando...");
  const [isConnected, setIsConnected] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [stream, setStream] = useState<MediaStream | null>(null);

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
          frameRate: { ideal: 30 }
        },
        audio: false 
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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?roomId=${roomId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      setStatus("Negociando conexão...");
      
      const configuration = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };
      
      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;

      currentStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setStatus("Transmitindo ao vivo");
          setIsConnected(true);
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setStatus("Conexão perdida. Tentando reconectar...");
          setIsConnected(false);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", offer }));

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === "candidate") {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      };
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
        stream.getTracks().forEach(t => t.stop());
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
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
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
            <span className="text-sm font-bold tracking-wide">{isConnected ? 'AO VIVO' : 'CONECTANDO'}</span>
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
          className={`w-full h-full object-cover transition-opacity duration-700 ${stream ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    </div>
  );
}

export default function TransmitirPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#0A0A0B] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    }>
      <TransmitirContent />
    </Suspense>
  );
}
