// STREAM_LIMIT race runner (PLAN.md §8.1), single-trial version.
// Phase 4 adds trials, experiment_run persistence and the CLI bench on top of this.

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { appPool, labPool } from '../db/pool.js';
import { newStats, type Isolation } from '../db/tx.js';
import { setUniqueIndex } from '../strategies/constraint.js';
import { executeClaim, strategies, type ClaimMode, type StrategyName } from '../strategies/index.js';
import { checkInvariant } from './invariant.js';

export interface RaceParams {
  strategy: StrategyName;
  isolation?: Isolation;
  concurrency: number;      // simultaneous claims
  accounts: number;         // 1 = maximum contention, 16 = spread
  maxStreams: number;
  raceDelayMs: number;      // sleep between check and write
  mode: ClaimMode;
}

export interface RaceResult extends RaceParams {
  isolationUsed: string;
  granted: number; rejected: number; errors: number;
  retries: number; deadlocks: number; lockTimeouts: number;
  violations: number;
  p50Ms: number; p95Ms: number; wallMs: number; throughputRps: number;
  errorSamples: string[];
}

export class RaceParamError extends Error {}

const DEVICES_PER_ACCOUNT = 64;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** Lab accounts in id order, each with its device ids in order. */
async function labTopology(accounts: number) {
  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT a.account_id, d.device_id FROM account a JOIN device d ON d.account_id = a.account_id
     WHERE a.is_lab = TRUE ORDER BY a.account_id, d.device_id`);
  const byAccount = new Map<number, number[]>();
  for (const r of rows) {
    if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, []);
    byAccount.get(r.account_id)!.push(r.device_id);
  }
  return [...byAccount.entries()].slice(0, accounts).map(([accountId, devices]) => ({ accountId, devices }));
}

export async function runRace(p: RaceParams, restoreIndexFor: StrategyName): Promise<RaceResult> {
  const strategy = strategies[p.strategy];
  if (p.maxStreams > 1 && !strategy.supportsMaxStreamsAbove1) {
    throw new RaceParamError(`${p.strategy} only supports max_streams = 1`);
  }
  if (p.concurrency > p.accounts * DEVICES_PER_ACCOUNT) {
    throw new RaceParamError(`concurrency ${p.concurrency} needs more than ${DEVICES_PER_ACCOUNT} devices per account`);
  }
  const topo = await labTopology(p.accounts);
  const accountIds = topo.map((t) => t.accountId);

  // 1. Reset lab state and put the schema in the shape this strategy expects.
  const admin = await appPool.getConnection();
  try {
    await admin.query('DELETE FROM playback_event WHERE account_id IN (SELECT account_id FROM account WHERE is_lab)');
    await admin.query('DELETE FROM playback_session WHERE account_id IN (SELECT account_id FROM account WHERE is_lab)');
    await admin.query('UPDATE account SET max_streams = ?, state_version = 0 WHERE is_lab', [p.maxStreams]);
    await setUniqueIndex(admin, strategy.needsUniqueIndex);
  } finally {
    admin.release();
  }

  // 2. Pre-acquire every connection so no request queues at the pool (that would hide the race).
  const conns: PoolConnection[] = await Promise.all(Array.from({ length: p.concurrency }, () => labPool.getConnection()));
  const stats = newStats();
  const latencies: number[] = [];
  const errorSamples = new Set<string>();
  let granted = 0, rejected = 0, errors = 0;

  // 3. Barrier: all workers wait on one promise, then start together.
  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const workers = conns.map(async (conn, i) => {
    const target = topo[i % p.accounts]!;
    await barrier;
    const t0 = process.hrtime.bigint();
    try {
      const r = await executeClaim(strategy, conn, {
        accountId: target.accountId, deviceId: target.devices[Math.floor(i / p.accounts)]!,
        songId: 1, mode: p.mode, raceDelayMs: p.raceDelayMs, isolation: p.isolation,
      }, stats);
      if (r.outcome === 'GRANTED') granted++; else rejected++;
    } catch (err) {
      errors++;
      const e = err as { code?: string; name?: string; message?: string };
      errorSamples.add(e.code ?? e.name ?? String(e.message));
    } finally {
      latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
      conn.release();
    }
  });

  const start = process.hrtime.bigint();
  release();
  await Promise.all(workers);
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;

  // 4. Invariant check, then restore the index to whatever the live app needs.
  const { violations } = await checkInvariant(appPool, accountIds);
  const admin2 = await appPool.getConnection();
  try {
    await setUniqueIndex(admin2, strategies[restoreIndexFor].needsUniqueIndex);
  } finally {
    admin2.release();
  }

  latencies.sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    ...p,
    isolationUsed: p.isolation ?? strategy.defaultIsolation,
    granted, rejected, errors,
    retries: stats.retries, deadlocks: stats.deadlocks, lockTimeouts: stats.lockTimeouts,
    violations,
    p50Ms: round(percentile(latencies, 50)), p95Ms: round(percentile(latencies, 95)),
    wallMs: round(wallMs), throughputRps: round((p.concurrency / wallMs) * 1000),
    errorSamples: [...errorSamples],
  };
}
