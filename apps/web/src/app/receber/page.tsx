"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import QRCode from "react-qr-code";
import { v4 as uuidv4 } from "uuid";
import { useSearchParams } from "next/navigation";

function ReceberContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Gerando sala...");
  const [isConnected, setIsConnected] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const searchParams = useSearchParams();
  const isClean = searchParams.get("clean") === "1";

  useEffect(() => {
    const id = uuidv4().slice(0, 6);
    setRoomId(id);
    setStatus("Aguardando transmissor...");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?roomId=${id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => console.log("WebSocket connected");

    const configuration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
    const pc = new RTCPeerConnection(configuration);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      console.log("Recebendo stream de vídeo!");
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setIsConnected(true);
        setStatus("Conectado");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("State:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setIsConnected(false);
        setStatus("Desconectado. Aguardando reconexão...");
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

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      {!isClean && (
        <div className="absolute top-4 left-4 z-10 bg-black/50 p-4 rounded-lg backdrop-blur-md">
          <h1 className="text-xl font-bold mb-2">Receptor Pelidev</h1>
          <p className="text-sm text-gray-300">Status: {status}</p>
          <p className="text-sm text-gray-300">Sala: {roomId}</p>
        </div>
      )}

      {/* Video Container */}
      <div className={`relative w-full max-w-5xl aspect-video bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center ${isClean ? 'h-screen max-w-none rounded-none' : ''}`}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain ${!isConnected ? 'hidden' : ''}`}
        />
        
        {!isConnected && !isClean && roomId && (
          <div className="flex flex-col items-center space-y-6">
            <div className="p-4 bg-white rounded-xl">
              <QRCode value={transmitUrl} size={256} />
            </div>
            <p className="text-center max-w-md text-gray-400">
              Escaneie o código com o celular para iniciar a transmissão.
            </p>
            <p className="text-xs text-gray-500 font-mono break-all">{transmitUrl}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReceberPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-black text-white p-8">Carregando...</div>}>
      <ReceberContent />
    </Suspense>
  );
}
