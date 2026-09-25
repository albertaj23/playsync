import { z } from 'zod';
import { ISOLATIONS, type Isolation } from '../../db/tx.js';
import { STRATEGY_NAMES, strategies } from '../../strategies/index.js';
import type { SimConfig } from './types.js';

export class SimConfigError extends Error {}

const num = (min: number, max: number, def: number) => z.coerce.number().min(min).max(max).default(def);
const int = (min: number, max: number, def: number) => z.coerce.number().int().min(min).max(max).default(def);

export const SimConfigSchema = z.object({
  strategy: z.enum(STRATEGY_NAMES).default('NAIVE'),
  maxStreams: int(1, 4, 1),
  accounts: int(1, 16, 1),
  devicesPerAccount: int(2, 64, 8),
  arrival: z.enum(['BURST', 'STEADY', 'RUSH']).default('BURST'),
  ratePerSec: num(0.2, 20, 2),
  checkDelayMs: int(0, 50, 0),
  jitterMs: int(0, 500, 0),
  offlinePct: int(0, 50, 0),
  leaseSec: int(5, 60, 15),
  policy: z.enum(['REJECT', 'TAKEOVER', 'ASK']).default('REJECT'),
  askYesPct: int(0, 100, 70),
  crashPct: int(0, 20, 0),
  isolation: z.enum(ISOLATIONS as [Isolation, ...Isolation[]]).default('REPEATABLE READ'),
  durationSec: int(10, 180, 60),
  listenMinSec: int(3, 30, 5),
  listenMaxSec: int(3, 30, 12),
});

/** Fields that can change while a run is in progress. */
export const LIVE_FIELDS = ['strategy', 'ratePerSec', 'checkDelayMs', 'jitterMs', 'offlinePct', 'crashPct'] as const;
export type LiveField = (typeof LIVE_FIELDS)[number];

export function parseConfig(input: unknown): SimConfig {
  const c = SimConfigSchema.parse(input ?? {}) as SimConfig;
  if (c.listenMinSec > c.listenMaxSec) throw new SimConfigError('listening time: min must not exceed max');
  assertStrategyFits(c.strategy, c.maxStreams);
  return c;
}

export function assertStrategyFits(strategy: SimConfig['strategy'], maxStreams: number): void {
  if (maxStreams > 1 && !strategies[strategy].supportsMaxStreamsAbove1) {
    throw new SimConfigError(`${strategy} only supports one screen per household`);
  }
}

export function parseLivePatch(input: unknown): Partial<Pick<SimConfig, LiveField>> {
  const body = (input ?? {}) as Record<string, unknown>;
  const bad = Object.keys(body).filter((k) => !(LIVE_FIELDS as readonly string[]).includes(k));
  if (bad.length) throw new SimConfigError(`cannot change ${bad.join(', ')} while a run is in progress; stop and restart`);
  const shape = SimConfigSchema.shape;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(body)) out[k] = (shape[k as LiveField] as z.ZodTypeAny).parse(body[k]);
  return out as Partial<Pick<SimConfig, LiveField>>;
}

export const PRESETS: { id: string; label: string; story: string; explainScenario: string; config: Partial<SimConfig> }[] = [
  { id: 'break-it', label: 'Break it', story: 'Everyone hits Play at the same second, and nobody is guarding the door.', explainScenario: 'RACE_TXN_RR',
    config: { strategy: 'NAIVE', arrival: 'BURST', accounts: 1, devicesPerAccount: 32, maxStreams: 1, checkDelayMs: 20 } },
  { id: 'family-fight', label: 'Family fight', story: 'Four people, one screen, all evening.', explainScenario: 'PESSIMISTIC_RC',
    config: { strategy: 'PESSIMISTIC', arrival: 'STEADY', accounts: 1, devicesPerAccount: 4, maxStreams: 1, policy: 'TAKEOVER', ratePerSec: 0.6 } },
  { id: 'release-night', label: 'Release-night rush', story: 'A new album drops; traffic ramps to peak.', explainScenario: 'OPTIMISTIC_CAS',
    config: { strategy: 'OPTIMISTIC', arrival: 'RUSH', accounts: 16, devicesPerAccount: 32, maxStreams: 2, ratePerSec: 4 } },
  { id: 'flaky-wifi', label: 'Flaky Wi-Fi', story: 'Phones fall asleep mid-song; tickets must expire.', explainScenario: 'PESSIMISTIC_RC',
    config: { strategy: 'PESSIMISTIC', arrival: 'STEADY', offlinePct: 30, leaseSec: 8, accounts: 4, devicesPerAccount: 6, maxStreams: 2, ratePerSec: 1 } },
  { id: 'crash', label: 'Crash mid-play', story: 'The server dies halfway through starting a song.', explainScenario: 'KILL_RECOVERY',
    config: { strategy: 'PESSIMISTIC', arrival: 'STEADY', crashPct: 15, accounts: 2, devicesPerAccount: 6, maxStreams: 1, ratePerSec: 1.5 } },
  { id: 'strict-slow', label: 'Strict but slow', story: 'Perfectly safe, but are listeners happy?', explainScenario: 'SERIALIZABLE_DEADLOCK',
    config: { strategy: 'SERIALIZABLE', arrival: 'BURST', accounts: 16, devicesPerAccount: 32, maxStreams: 1 } },
];

export const CAPS = {
  maxStreams: [1, 4], accounts: [1, 16], devicesPerAccount: [2, 64], ratePerSec: [0.2, 20], checkDelayMs: [0, 50],
  jitterMs: [0, 500], offlinePct: [0, 50], leaseSec: [5, 60], crashPct: [0, 20], durationSec: [10, 180], listenSec: [3, 30],
};

export const FRIENDLY_STRATEGY: Record<string, string> = {
  NAIVE: 'No protection', TXN_RR: 'Transaction, no locks', SERIALIZABLE: 'Strictest isolation',
  PESSIMISTIC: 'Lock, then check', OPTIMISTIC: 'Check, then retry on conflict', CONSTRAINT: 'Reserve a numbered slot', TRIGGER: 'Database watchdog (trigger)', REDIS_LEASE: 'Key-value gatekeeper (Redis)',
};
