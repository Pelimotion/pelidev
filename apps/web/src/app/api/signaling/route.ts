import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";

// In-memory store for signaling (Note: Limited to same instance, Vercel Beta)
const rooms = new Map<string, Set<WebSocket>>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");

  if (!roomId) {
    return new Response("Missing roomId", { status: 400 });
  }

  return experimental_upgradeWebSocket((ws) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    const room = rooms.get(roomId)!;
    room.add(ws);

    console.log(`[Signaling] Client connected to room: ${roomId}. Total clients: ${room.size}`);

    ws.on("message", (data) => {
      // Broadcast to all OTHER clients in the room
      for (const client of room) {
        if (client !== ws && client.readyState === 1 /* OPEN */) {
          client.send(data);
        }
      }
    });

    ws.on("close", () => {
      room.delete(ws);
      console.log(`[Signaling] Client disconnected from room: ${roomId}. Remaining: ${room.size}`);
      if (room.size === 0) {
        rooms.delete(roomId);
      }
    });
    
    ws.on("error", (err) => {
        console.error(`[Signaling Error] Room ${roomId}:`, err);
    });
  });
}
