import type { Isolation } from '../../db/tx.js';
import type { StrategyName } from '../../strategies/index.js';

export type SimPhase = 'IDLE' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'DONE';
export type Arrival = 'BURST' | 'STEADY' | 'RUSH';
export type SimPolicy = 'REJECT' | 'TAKEOVER' | 'ASK';

export interface SimConfig {
  strategy: StrategyName;
  maxStreams: number;
  accounts: number;
  devicesPerAccount: number;
  arrival: Arrival;
  ratePerSec: number;
  checkDelayMs: number;
  jitterMs: number;
  offlinePct: number;
  leaseSec: number;
  policy: SimPolicy;
  askYesPct: number;
  crashPct: number;
  isolation: Isolation;
  durationSec: number;
  listenMinSec: number;
  listenMaxSec: number;
}

export type VDeviceState = 'IDLE' | 'PRESSING' | 'PLAYING' | 'REJECTED' | 'RETRYING' | 'FAILED' | 'MOVED' | 'OFFLINE';

export interface SimEvent {
  id: number;
  tMs: number;
  kind: 'reject' | 'move' | 'crash' | 'violation' | 'cleared' | 'switch' | 'repair' | 'offline' | 'expired' | 'fail';
  message: string;
  tech: Record<string, unknown>;
}

export interface Kpis {
  presses: number; played: number; rejected: number; moved: number; failed: number;
  retries: number; deadlocks: number; lockTimeouts: number;
  violatingHouseholds: number; peakExcess: number; violationSeconds: number; newViolationEvents: number;
  happinessPct: number; p50Ms: number; p95Ms: number; playsPerSec: number;
}

export interface SeriesPoint { t: number; playsPerSec: number; p95Ms: number; violating: number; happiness: number }

export interface HouseholdInfo { id: number; name: string; devices: { id: number; name: string; type: string }[] }

export interface HouseholdLive { active: number; max: number }

export interface DeviceDiff { h: number; d: number; state: VDeviceState; song?: string; retries?: number }

export interface SimTick {
  seq: number;
  phase: SimPhase;
  elapsedMs: number;
  config: SimConfig;
  kpis: Kpis;
  households: HouseholdLive[];
  devices: DeviceDiff[];
  events: SimEvent[];
  series?: SeriesPoint;
  markers: { tMs: number; label: string }[];
  queueDepth: number;
}

export interface SimSummary {
  batchId: string | null;
  config: SimConfig;
  kpis: Kpis;
  verdict: 'HELD' | 'BROKEN';
  markers: { tMs: number; label: string }[];
  series: SeriesPoint[];
  wallMs: number;
}

export interface SimSnapshot extends SimTick {
  seriesAll: SeriesPoint[];
  names: HouseholdInfo[];
  allDevices: DeviceDiff[];
  summary: SimSummary | null;
}
