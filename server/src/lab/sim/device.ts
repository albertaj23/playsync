import type { VDeviceState } from './types.js';

/** One virtual listening device. Timers are plain timestamps polled by the engine loop (no per-device timers). */
export interface VDevice {
  h: number;                 // household index
  d: number;                 // device index within the household
  accountId: number;
  deviceId: number;
  state: VDeviceState;
  sessionId: number | null;
  song?: string;
  offline: boolean;          // stopped heartbeating; its lease will lapse
  listenEndsAt: number;
  nextHeartbeatAt: number;
  coolUntil: number;         // REJECTED/FAILED/MOVED revert to IDLE at this time
  busy: boolean;             // a heartbeat/release call is in flight
  retries: number;
}

export const newDevice = (h: number, d: number, accountId: number, deviceId: number): VDevice => ({
  h, d, accountId, deviceId, state: 'IDLE', sessionId: null, offline: false,
  listenEndsAt: 0, nextHeartbeatAt: 0, coolUntil: 0, busy: false, retries: 0,
});

export const rand = (min: number, max: number) => min + Math.random() * (max - min);
export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
