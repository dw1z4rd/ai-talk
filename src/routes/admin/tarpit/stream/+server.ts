import fs from 'node:fs/promises';
import path from 'node:path';
import { tarpitBus, getTarpitMode, setTarpitMode, type TarpitMode } from '$lib/server/tarpit-bus';
import type { RequestHandler } from './$types';

const encoder = new TextEncoder();
const BOMB_PATH = path.join(process.cwd(), 'logs', 'bomb.gz');
const LOG_PATH = path.join(process.cwd(), 'logs', 'tarpit_victims.jsonl');

const encodeSSE = (data: unknown): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

async function loadInitialState() {
  let victims: any[] = [];
  let totalWasted = 0;
  try {
    const raw = await fs.readFile(LOG_PATH, 'utf-8');
    const logs = raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    const drops = logs.filter((l: any) => l.event === 'connection_dropped' || l.event === 'bomb_served');
    drops.sort((a: any, b: any) => parseFloat(b.duration_seconds ?? 0) - parseFloat(a.duration_seconds ?? 0));
    totalWasted = drops.reduce((acc: number, l: any) => acc + parseFloat(l.duration_seconds ?? 0), 0);
    victims = drops.slice(0, 50);
  } catch { /* no log file yet */ }

  let bombSizeBytes: number | null = null;
  try {
    const stat = await fs.stat(BOMB_PATH);
    bombSizeBytes = stat.size;
  } catch { /* bomb not generated yet */ }

  return { victims, totalWasted: totalWasted.toFixed(1), bombSizeBytes, mode: getTarpitMode() };
}

export const DELETE: RequestHandler = async () => {
  try {
    await fs.unlink(LOG_PATH);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      return new Response('Failed to delete logs', { status: 500 });
    }
  }
  return new Response(null, { status: 204 });
};

const VALID_MODES: TarpitMode[] = ['random', 'llm', 'bomb'];

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const mode = body?.mode;
  if (!VALID_MODES.includes(mode)) {
    return new Response(JSON.stringify({ error: 'Invalid mode. Must be: random, llm, or bomb' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  setTarpitMode(mode);
  return new Response(JSON.stringify({ mode }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const GET: RequestHandler = ({ request }) => {
  const stream = new ReadableStream({
    async start(controller) {
      let alive = true;

      const cleanup = () => {
        alive = false;
        tarpitBus.off('bot_detected', onBotDetected);
        tarpitBus.off('bomb_served', onBombServed);
        tarpitBus.off('tarpit_chunk', onTarpitChunk);
        tarpitBus.off('bot_disconnected', onBotDisconnected);
        tarpitBus.off('bomb_ready', onBombReady);
        tarpitBus.off('mode_changed', onModeChanged);
        try { controller.close(); } catch { /* already closed */ }
      };

      const safeSend = (data: unknown) => {
        if (!alive) return;
        try {
          controller.enqueue(encodeSSE(data));
        } catch {
          cleanup();
        }
      };

      // Send initial state on connect
      const initial = await loadInitialState();
      safeSend({ type: 'init', ...initial });

      // Subscribe to live events
      const onBotDetected = (payload: unknown) => safeSend({ type: 'bot_detected', ...payload as object });
      const onBombServed = (payload: unknown) => safeSend({ type: 'bomb_served', ...payload as object });
      const onTarpitChunk = (payload: unknown) => safeSend({ type: 'tarpit_chunk', ...payload as object });
      const onBombReady = (payload: unknown) => safeSend({ type: 'bomb_ready', ...payload as object });
      const onModeChanged = (payload: unknown) => safeSend({ type: 'mode_changed', ...payload as object });
      const onBotDisconnected = (payload: unknown) => {
        safeSend({ type: 'bot_disconnected', ...payload as object });
      };

      tarpitBus.on('bot_detected', onBotDetected);
      tarpitBus.on('bomb_served', onBombServed);
      tarpitBus.on('tarpit_chunk', onTarpitChunk);
      tarpitBus.on('bot_disconnected', onBotDisconnected);
      tarpitBus.on('bomb_ready', onBombReady);
      tarpitBus.on('mode_changed', onModeChanged);

      request.signal.addEventListener('abort', cleanup);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  });
};
