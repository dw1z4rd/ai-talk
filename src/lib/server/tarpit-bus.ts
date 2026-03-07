import { EventEmitter } from 'node:events';
const bus = new EventEmitter();
bus.setMaxListeners(0);
export const tarpitBus = bus;

export type TarpitMode = 'random' | 'llm' | 'bomb';

export interface ActiveSession {
    sessionId: string;
    ip: string;
    path: string;
    userAgent: string;
    timestamp: string;
    type: 'pending' | 'bomb' | 'tarpit';
    filename?: string;
    content: string;
}

export const activeSessions = new Map<string, ActiveSession>();

let currentMode: TarpitMode = 'random';

export const getTarpitMode = (): TarpitMode => currentMode;

export const setTarpitMode = (mode: TarpitMode): void => {
    currentMode = mode;
    tarpitBus.emit('mode_changed', { mode });
};
