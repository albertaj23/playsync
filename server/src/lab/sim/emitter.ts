// Push interface for the simulation, same pattern as stepper/emitter.ts: no-op by default,
// realtime/socket.ts installs the real one that forwards to the 'sim' room.
import type { SimSummary, SimTick } from './types.js';

export interface SimEmitter { tick(t: SimTick): void; done(s: SimSummary): void }

let current: SimEmitter = { tick() {}, done() {} };
export const simEmit = (): SimEmitter => current;
export function setSimEmitter(e: SimEmitter | null): void { current = e ?? { tick() {}, done() {} }; }
