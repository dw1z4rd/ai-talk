import { WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { WebSocket } from "ws";

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: any) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (request.url === "/ws") {
        wss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          wss?.emit("connection", ws, request);
        });
      }
    },
  );

  console.log("[WebSocket] Server initialized on /ws");
  return wss;
}
