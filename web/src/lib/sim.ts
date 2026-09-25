// Simulation Control Room: types (mirroring server/src/lab/sim/types.ts), friendly copy, and a
// seq-guarded reducer that merges ticks into one state.

export type StrategyName = 'NAIVE' | 'TXN_RR' | 'SERIALIZABLE' | 'PESSIMISTIC' | 'OPTIMISTIC' | 'CONSTRAINT' | 'TRIGGER' | 'REDIS_LEASE';
export type SimPhase = 'IDLE' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'DONE';
export type VDeviceState = 'IDLE' | 'PRESSING' | 'PLAYING' | 'REJECTED' | 'RETRYING' | 'FAILED' | 'MOVED' | 'OFFLINE';

export interface SimConfig {
  strategy: StrategyName; maxStreams: number; accounts: number; devicesPerAccount: number;
  arrival: 'BURST' | 'STEADY' | 'RUSH'; ratePerSec: number; checkDelayMs: number; jitterMs: number;
  offlinePct: number; leaseSec: number; policy: 'REJECT' | 'TAKEOVER' | 'ASK'; askYesPct: number; crashPct: number;
  isolation: 'READ COMMITTED' | 'REPEATABLE READ'; durationSec: number; listenMinSec: number; listenMaxSec: number;
}

export interface Kpis {
  presses: number; played: number; rejected: number; moved: number; failed: number;
  retries: number; deadlocks: number; lockTimeouts: number;
  violatingHouseholds: number; peakExcess: number; violationSeconds: number; newViolationEvents: number;
  happinessPct: number; p50Ms: number; p95Ms: number; playsPerSec: number;
}
export interface SeriesPoint { t: number; playsPerSec: number; p95Ms: number; violating: number; happiness: number }
export interface SimEvent { id: number; tMs: number; kind: string; message: string; tech: Record<string, unknown> }
export interface DeviceDiff { h: number; d: number; state: VDeviceState; song?: string; retries?: number }
export interface HouseholdInfo { id: number; name: string; devices: { id: number; name: string; type: string }[] }
export interface Marker { tMs: number; label: string }

export interface SimTick {
  seq: number; phase: SimPhase; elapsedMs: number; config: SimConfig; kpis: Kpis;
  households: { active: number; max: number }[]; devices: DeviceDiff[]; events: SimEvent[];
  series?: SeriesPoint; markers: Marker[]; queueDepth: number;
}
export interface SimSummary {
  batchId: string | null; config: SimConfig; kpis: Kpis; verdict: 'HELD' | 'BROKEN'; markers: Marker[]; series: SeriesPoint[]; wallMs: number;
}
export interface SimSnapshot extends SimTick { seriesAll: SeriesPoint[]; names: HouseholdInfo[]; allDevices: DeviceDiff[]; summary: SimSummary | null }

export interface Preset { id: string; label: string; story: string; explainScenario: string; config: Partial<SimConfig> }

export const FRIENDLY_STRATEGY: Record<StrategyName, string> = {
  NAIVE: 'No protection', TXN_RR: 'Transaction, no locks', SERIALIZABLE: 'Strictest isolation',
  PESSIMISTIC: 'Lock, then check', OPTIMISTIC: 'Check, then retry on conflict', CONSTRAINT: 'Reserve a numbered slot', TRIGGER: 'Database watchdog (trigger)', REDIS_LEASE: 'Key-value gatekeeper (Redis)',
};

export const DEFAULT_CONFIG: SimConfig = {
  strategy: 'NAIVE', maxStreams: 1, accounts: 1, devicesPerAccount: 8, arrival: 'BURST', ratePerSec: 2,
  checkDelayMs: 0, jitterMs: 0, offlinePct: 0, leaseSec: 15, policy: 'REJECT', askYesPct: 70, crashPct: 0,
  isolation: 'REPEATABLE READ', durationSec: 60, listenMinSec: 5, listenMaxSec: 12,
};

export const LIVE_FIELDS = ['strategy', 'ratePerSec', 'checkDelayMs', 'jitterMs', 'offlinePct', 'crashPct'] as const;

export interface SimState {
  seq: number; phase: SimPhase; elapsedMs: number; config: SimConfig; kpis: Kpis | null;
  households: { active: number; max: number }[]; devices: Record<string, DeviceDiff>;
  events: SimEvent[]; markers: Marker[]; series: SeriesPoint[]; names: HouseholdInfo[]; summary: SimSummary | null;
  queueDepth: number;
}

export const initialSim: SimState = {
  seq: 0, phase: 'IDLE', elapsedMs: 0, config: DEFAULT_CONFIG, kpis: null, households: [], devices: {},
  events: [], markers: [], series: [], names: [], summary: null, queueDepth: 0,
};

export type SimAction =
  | { type: 'snapshot'; s: SimSnapshot }
  | { type: 'tick'; t: SimTick }
  | { type: 'done'; s: SimSummary };

const key = (d: { h: number; d: number }) => `${d.h}:${d.d}`;
const MAX_EVENTS = 200;

export function simReducer(state: SimState, a: SimAction): SimState {
  if (a.type === 'snapshot') {
    const s = a.s;
    return {
      ...initialSim, seq: s.seq, phase: s.phase, elapsedMs: s.elapsedMs, config: s.config, kpis: s.kpis,
      households: s.households, devices: Object.fromEntries(s.allDevices.map((d) => [key(d), d])),
      events: s.events, markers: s.markers, series: s.seriesAll?.length ? s.seriesAll : (s.summary?.series ?? []), names: s.names, summary: s.summary, queueDepth: s.queueDepth,
    };
  }
  if (a.type === 'done') return { ...state, summary: a.s };
  const t = a.t;
  // seq 1 is the first tick of a fresh run: start clean. Otherwise drop anything out of order.
  const base = t.seq === 1 ? { ...initialSim, names: state.names } : state;
  if (t.seq !== 1 && t.seq <= state.seq) return state;
  const devices = { ...base.devices };
  for (const d of t.devices) devices[key(d)] = d;
  const seen = new Set(base.events.map((e) => e.id));
  const events = [...base.events, ...t.events.filter((e) => !seen.has(e.id))].slice(-MAX_EVENTS);
  return {
    ...base, seq: t.seq, phase: t.phase, elapsedMs: t.elapsedMs, config: t.config, kpis: t.kpis,
    households: t.households, devices, events, markers: t.markers, queueDepth: t.queueDepth,
    series: t.series ? [...base.series, t.series] : base.series, summary: t.seq === 1 ? null : base.summary,
  };
}
