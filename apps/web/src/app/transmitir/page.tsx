"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, RefreshCw } from "lucide-react";

function TransmitirContent() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  const [status, setStatus] = useState("Iniciando...");
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
        audio: false // Para MVP de webcam, apenas vídeo
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
      setStatus("Conectado à sala. Negociando conexão...");
      
      const configuration = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };
      
      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;

      // Adiciona as tracks da câmera ao PeerConnection
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
          setStatus("Transmitindo ao vivo!");
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setStatus("Conexão perdida. Tentando reconectar...");
        }
      };

      // Cria a oferta
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
  }, [roomId]); // Removido facingMode para não recriar a conexão toda vez que mudar a câmera. 

  const toggleCamera = async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    
    const newStream = await startCamera(newMode);
    
    // Troca a track enviada no WebRTC sem derrubar a conexão
    if (newStream && pcRef.current) {
      const videoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
    }
  };

  if (!roomId) {
    return <div className="p-8 text-center text-white bg-black h-screen">URL inválida. Escaneie o QR Code no receptor.</div>;
  }

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start">
        <div className="bg-black/50 p-3 rounded-lg backdrop-blur-md">
          <p className="text-sm font-bold flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status === 'Transmitindo ao vivo!' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`}></span>
            Transmissor
          </p>
          <p className="text-xs text-gray-300 mt-1">{status}</p>
        </div>
        
        <button 
          onClick={toggleCamera}
          className="bg-white/20 p-3 rounded-full backdrop-blur-md hover:bg-white/30 transition"
        >
          <RefreshCw size={24} />
        </button>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export default function TransmitirPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-black text-white p-8">Carregando câmera...</div>}>
      <TransmitirContent />
    </Suspense>
  );
}
