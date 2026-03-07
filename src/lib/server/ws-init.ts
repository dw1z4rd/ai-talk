import { dev } from '$app/environment';
import { initWebSocketServer } from '$lib/server/websocket';
import type { Handle } from '@sveltejs/kit';

let wsServerInitialized = false;

export const handleWsInit: Handle = async ({ event, resolve }) => {
    if (dev && !wsServerInitialized && event.platform) {
        const httpServer = (event.platform as any).httpServer;
        if (httpServer) {
            initWebSocketServer(httpServer);
            wsServerInitialized = true;
            console.log('[Server] WebSockets Initialized');
        }
    }
    return resolve(event);
};