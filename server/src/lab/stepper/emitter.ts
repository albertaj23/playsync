// Push interface for the stepper, mirroring realtime/publisher.ts: the engine calls
// emitStepperUpdate() whenever a step settles (possibly well after its HTTP response already
// returned WAITING); realtime/socket.ts installs the real implementation that forwards it to the
// 'stepper' room. Defaults to a no-op so the engine works (and is testable) without socket.io.

import type { StepperUpdate } from './types.js';

export type StepperEmitter = (update: StepperUpdate) => void;

let current: StepperEmitter = () => {};

export const emitStepperUpdate: StepperEmitter = (update) => current(update);

export function setStepperEmitter(fn: StepperEmitter | null): void {
  current = fn ?? (() => {});
}
