import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: any) {
  if (wss) return wss;
  
  wss = new WebSocketServer({ noServer: true });
  
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url === '/ws') {
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit('connection', ws, request);
      });
    }
  });
  
  console.log('[WebSocket] Server initialized on /ws');
  return wss;
}
