// STREAM_LIMIT race runner (PLAN.md §8.1).
//
// runRace() fires one trial: reset the lab accounts, pre-acquire every connection, release them
// all at once past a barrier, then check the invariant. It does NOT touch the unique index or the
// lab lock - that is the caller's job, because a multi-trial experiment must set the index once
// and hold the lock for the whole run, not per trial.
//
// runStreamLimitExperiment() is the caller: it validates, takes the lab lock, sets the index,
// repeats runRace() `trials` times, persists each trial to experiment_run, and restores the index.

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { appPool, labPool } from '../db/pool.js';
import { config } from '../config.js';
import { newStats, type Isolation } from '../db/tx.js';
import { setUniqueIndex } from '../strategies/constraint.js';
import { executeClaim, strategies, type ClaimMode, type StrategyName } from '../strategies/index.js';
import { checkInvariant } from './invariant.js';
import { withLabLock } from './labLock.js';
import { saveRun, type RunSource } from './persist.js';
import { mean, median, percentile, round2 } from './stats.js';

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

function validate(p: { strategy: StrategyName; concurrency: number; accounts: number; maxStreams: number }) {
  const strategy = strategies[p.strategy];
  if (p.maxStreams > 1 && !strategy.supportsMaxStreamsAbove1) {
    throw new RaceParamError(`${p.strategy} only supports max_streams = 1`);
  }
  if (p.concurrency > p.accounts * DEVICES_PER_ACCOUNT) {
    throw new RaceParamError(`concurrency ${p.concurrency} needs more than ${DEVICES_PER_ACCOUNT} devices per account`);
  }
  // If the pool is smaller than the concurrency, requests queue at the pool and the race window
  // disappears (PLAN.md §8.1): every worker gets its turn instead of racing.
  if (p.concurrency > config.LAB_POOL_SIZE) {
    throw new RaceParamError(`concurrency ${p.concurrency} exceeds LAB_POOL_SIZE (${config.LAB_POOL_SIZE})`);
  }
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

/**
 * One trial: reset the lab accounts targeted by `p.accounts`, fire `p.concurrency` simultaneous
 * claims, then check the invariant. Assumes the caller has already set the unique index for
 * `p.strategy` and holds the lab lock - this function does neither.
 */
export async function runRace(p: RaceParams): Promise<RaceResult> {
  validate(p);
  const strategy = strategies[p.strategy];
  const topo = await labTopology(p.accounts);
  const accountIds = topo.map((t) => t.accountId);

  // 1. Reset lab state for this trial.
  const admin = await appPool.getConnection();
  try {
    await admin.query('DELETE FROM playback_event WHERE account_id IN (SELECT account_id FROM account WHERE is_lab)');
    await admin.query('DELETE FROM playback_session WHERE account_id IN (SELECT account_id FROM account WHERE is_lab)');
    await admin.query('UPDATE account SET max_streams = ?, state_version = 0 WHERE is_lab', [p.maxStreams]);
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

  // 4. Invariant check.
  const { violations } = await checkInvariant(appPool, accountIds);

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

// ------------------------------------------------------------------ multi-trial experiment

export interface ExperimentRequest extends RaceParams {
  trials: number;          // 1..50
  batchId?: string;        // reuse to group several strategies of one comparison
  source: RunSource;
}

export interface TrialResult extends RaceResult { runId: number; trial: number; batchId: string }

export interface Aggregate {
  strategy: StrategyName; isolationUsed: string; trials: number;
  violationsTotal: number; trialsWithViolations: number; violationsMean: number; violationsMax: number;
  grantedMean: number; retriesMean: number; deadlocksMean: number; lockTimeoutsTotal: number; errorsTotal: number;
  p50Median: number; p95Median: number; throughputMean: number;
}

function aggregate(strategy: StrategyName, results: RaceResult[]): Aggregate {
  const violations = results.map((r) => r.violations);
  return {
    strategy,
    isolationUsed: results[0]?.isolationUsed ?? strategies[strategy].defaultIsolation,
    trials: results.length,
    violationsTotal: violations.reduce((a, b) => a + b, 0),
    trialsWithViolations: violations.filter((v) => v > 0).length,
    violationsMean: round2(mean(violations)),
    violationsMax: violations.length ? Math.max(...violations) : 0,
    grantedMean: round2(mean(results.map((r) => r.granted))),
    retriesMean: round2(mean(results.map((r) => r.retries))),
    deadlocksMean: round2(mean(results.map((r) => r.deadlocks))),
    lockTimeoutsTotal: results.reduce((a, r) => a + r.lockTimeouts, 0),
    errorsTotal: results.reduce((a, r) => a + r.errors, 0),
    p50Median: round2(median(results.map((r) => r.p50Ms))),
    p95Median: round2(median(results.map((r) => r.p95Ms))),
    throughputMean: round2(mean(results.map((r) => r.throughputRps))),
  };
}

/**
 * Runs `req.trials` trials of the STREAM_LIMIT experiment, persisting each trial to
 * experiment_run, and returns the per-trial results plus an aggregate. Holds the lab lock and
 * sets the unique index once for the whole run (restored to `restoreIndexFor` in `finally`, even
 * if a trial throws).
 */
export async function runStreamLimitExperiment(
  req: ExperimentRequest, restoreIndexFor: StrategyName,
): Promise<{ batchId: string; trials: TrialResult[]; aggregate: Aggregate }> {
  validate(req);
  if (req.trials < 1 || req.trials > 50) throw new RaceParamError('trials must be between 1 and 50');
  const batchId = req.batchId ?? crypto.randomUUID();
  const strategy = strategies[req.strategy];

  return withLabLock(async () => {
    const conn = await appPool.getConnection();
    try {
      await setUniqueIndex(conn, strategy.needsUniqueIndex);
    } finally {
      conn.release();
    }

    const trials: TrialResult[] = [];
    try {
      for (let trial = 1; trial <= req.trials; trial++) {
        const result = await runRace(req);
        const runId = await saveRun({
          experiment: 'STREAM_LIMIT', strategy: req.strategy, isolationLevel: result.isolationUsed,
          mode: req.mode, concurrency: req.concurrency, accounts: req.accounts, maxStreams: req.maxStreams,
          raceDelayMs: req.raceDelayMs, granted: result.granted, rejected: result.rejected,
          retries: result.retries, deadlocks: result.deadlocks, lockTimeouts: result.lockTimeouts,
          errors: result.errors, violations: result.violations, p50Ms: result.p50Ms, p95Ms: result.p95Ms,
          throughputRps: result.throughputRps, wallMs: result.wallMs, batchId, trial, source: req.source,
          detail: { errorSamples: result.errorSamples },
        });
        trials.push({ ...result, runId, trial, batchId });
      }
    } finally {
      const conn2 = await appPool.getConnection();
      try {
        await setUniqueIndex(conn2, strategies[restoreIndexFor].needsUniqueIndex);
      } finally {
        conn2.release();
      }
    }

    return { batchId, trials, aggregate: aggregate(req.strategy, trials) };
  });
}
