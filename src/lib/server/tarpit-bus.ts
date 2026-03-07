import { EventEmitter } from 'node:events';
const bus = new EventEmitter();
bus.setMaxListeners(0);
export const tarpitBus = bus;

export type TarpitMode = 'random' | 'llm' | 'bomb';

let currentMode: TarpitMode = 'random';

export const getTarpitMode = (): TarpitMode => currentMode;

export const setTarpitMode = (mode: TarpitMode): void => {
	currentMode = mode;
	tarpitBus.emit('mode_changed', { mode });
};
