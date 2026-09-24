// Classic LOST UPDATE experiment (PLAN.md §8.2): N concurrent read-modify-writes of one row's
// counter (song.play_count), demonstrating the anomaly that write skew is NOT: two transactions
// on the SAME row, each reading a value and writing back value+1, can silently drop increments.
//
// Each variant is commented with the anomaly it allows or prevents, like the strategy files.

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { appPool, labPool } from '../db/pool.js';
import { config } from '../config.js';
import { isDeadlock, isLockWaitTimeout } from '../db/errors.js';
import { newStats, sleep, withRetry, withTx, type Stats } from '../db/tx.js';
import { withLabLock } from './labLock.js';
import { saveRun, type RunSource } from './persist.js';
import { mean, median, percentile, round2 } from './stats.js';

export const LOST_UPDATE_VARIANTS = ['NAIVE_RMW', 'ATOMIC', 'LOCKED', 'CAS'] as const;
export type LostUpdateVariant = (typeof LOST_UPDATE_VARIANTS)[number];

export interface LostUpdateParams { variant: LostUpdateVariant; increments: number; raceDelayMs: number }

export interface LostUpdateResult extends LostUpdateParams {
  isolationUsed: string;
  succeeded: number; errors: number; retries: number; deadlocks: number;
  finalCount: number; lost: number;           // lost = succeeded - finalCount
  p50Ms: number; p95Ms: number; wallMs: number; throughputRps: number;
}

export class LostUpdateParamError extends Error {}

const ISOLATION_LABEL: Record<LostUpdateVariant, string> = {
  NAIVE_RMW: 'AUTOCOMMIT',
  ATOMIC: 'AUTOCOMMIT',
  LOCKED: 'READ COMMITTED',
  CAS: 'AUTOCOMMIT',
};

const CAS_MAX_ATTEMPTS = 500;

function validate(p: { increments: number }) {
  if (p.increments > config.LAB_POOL_SIZE) {
    throw new LostUpdateParamError(`increments ${p.increments} exceeds LAB_POOL_SIZE (${config.LAB_POOL_SIZE})`);
  }
}

/**
 * NAIVE_RMW: autocommit, no transaction. SELECT the current value, sleep (the "race window"),
 * write back (value + 1). ALLOWS the classic lost update: two workers can both read the same
 * value before either writes, so one worker's increment silently overwrites the other's.
 */
async function naiveRmw(conn: PoolConnection, songId: number, raceDelayMs: number): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT play_count FROM song WHERE song_id = ?', [songId]);
  const current = Number(rows[0]!.play_count);
  if (raceDelayMs) await sleep(raceDelayMs);
  await conn.query('UPDATE song SET play_count = ? WHERE song_id = ?', [current + 1, songId]);
}

/**
 * ATOMIC: the read-modify-write happens inside ONE statement, under the row's X lock the whole
 * time. PREVENTS lost updates: MySQL serializes concurrent UPDATEs of the same row, so `raceDelayMs`
 * (there is no window between a separate read and write) has no effect here - deliberately.
 */
async function atomic(conn: PoolConnection, songId: number): Promise<void> {
  await conn.query('UPDATE song SET play_count = play_count + 1 WHERE song_id = ?', [songId]);
}

/**
 * LOCKED: pessimistic. `SELECT ... FOR UPDATE` takes the row's X lock before reading, so every
 * other worker's read blocks until this transaction commits. PREVENTS lost updates by
 * serializing the read-modify-write entirely; the cost is that workers queue up one at a time
 * (wall time grows roughly with N x raceDelayMs).
 */
async function locked(conn: PoolConnection, songId: number, raceDelayMs: number, stats: Stats): Promise<void> {
  await withRetry(() => withTx(conn, 'READ COMMITTED', async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT play_count FROM song WHERE song_id = ? FOR UPDATE', [songId]);
    const current = Number(rows[0]!.play_count);
    if (raceDelayMs) await sleep(raceDelayMs);
    await conn.query('UPDATE song SET play_count = ? WHERE song_id = ?', [current + 1, songId]);
  }), stats);
}

/**
 * CAS (compare-and-set / optimistic): read the value, sleep, then write back ONLY if the value is
 * still what was read (`WHERE play_count = ?`). If another worker won the race, `affectedRows` is
 * 0 and we retry with the fresh value. PREVENTS lost updates without holding a lock while
 * "thinking"; the cost is retries, which grow with contention (workers colliding on one row).
 */
async function cas(conn: PoolConnection, songId: number, raceDelayMs: number, stats: Stats): Promise<void> {
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT play_count FROM song WHERE song_id = ?', [songId]);
    const current = Number(rows[0]!.play_count);
    if (raceDelayMs) await sleep(raceDelayMs);
    const [res] = await conn.query<ResultSetHeader>(
      'UPDATE song SET play_count = ? WHERE song_id = ? AND play_count = ?',
      [current + 1, songId, current],
    );
    if (res.affectedRows === 1) return;
    stats.retries++;
    await sleep(Math.random() * 5);
  }
  throw new Error(`CAS: gave up after ${CAS_MAX_ATTEMPTS} attempts`);
}

/** One trial: reset song.play_count to 0, fire `increments` concurrent workers, read the final count. */
export async function runLostUpdate(p: LostUpdateParams): Promise<LostUpdateResult> {
  validate(p);
  const [songRows] = await appPool.query<RowDataPacket[]>('SELECT MAX(song_id) AS id FROM song');
  const songId = Number(songRows[0]!.id);
  await appPool.query('UPDATE song SET play_count = 0 WHERE song_id = ?', [songId]);

  const conns: PoolConnection[] = await Promise.all(Array.from({ length: p.increments }, () => labPool.getConnection()));
  const stats = newStats();
  const latencies: number[] = [];
  let succeeded = 0, errors = 0;

  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const workers = conns.map(async (conn) => {
    await barrier;
    const t0 = process.hrtime.bigint();
    try {
      switch (p.variant) {
        case 'NAIVE_RMW': await naiveRmw(conn, songId, p.raceDelayMs); break;
        case 'ATOMIC': await atomic(conn, songId); break;
        case 'LOCKED': await locked(conn, songId, p.raceDelayMs, stats); break;
        case 'CAS': await cas(conn, songId, p.raceDelayMs, stats); break;
      }
      succeeded++;
    } catch (err) {
      errors++;
      if (isDeadlock(err)) stats.deadlocks++;
      if (isLockWaitTimeout(err)) stats.lockTimeouts++;
    } finally {
      latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
      conn.release();
    }
  });

  const start = process.hrtime.bigint();
  release();
  await Promise.all(workers);
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;

  const [finalRows] = await appPool.query<RowDataPacket[]>('SELECT play_count FROM song WHERE song_id = ?', [songId]);
  const finalCount = Number(finalRows[0]!.play_count);

  latencies.sort((a, b) => a - b);
  return {
    ...p,
    isolationUsed: ISOLATION_LABEL[p.variant],
    succeeded, errors, retries: stats.retries, deadlocks: stats.deadlocks,
    finalCount, lost: succeeded - finalCount,
    p50Ms: round2(percentile(latencies, 50)), p95Ms: round2(percentile(latencies, 95)),
    wallMs: round2(wallMs), throughputRps: round2((p.increments / wallMs) * 1000),
  };
}

// ------------------------------------------------------------------ multi-trial experiment

export interface LostUpdateExperimentRequest extends LostUpdateParams {
  trials: number;
  batchId?: string;
  source: RunSource;
}

export interface LostUpdateTrialResult extends LostUpdateResult { runId: number; trial: number; batchId: string }

export interface LostUpdateAggregate {
  variant: LostUpdateVariant; isolationUsed: string; trials: number;
  finalCountMean: number; lostTotal: number; trialsWithLoss: number; lostMean: number;
  retriesMean: number; errorsTotal: number; p50Median: number; p95Median: number; throughputMean: number;
}

function aggregateLostUpdate(variant: LostUpdateVariant, results: LostUpdateResult[]): LostUpdateAggregate {
  const lost = results.map((r) => r.lost);
  return {
    variant, isolationUsed: ISOLATION_LABEL[variant], trials: results.length,
    finalCountMean: round2(mean(results.map((r) => r.finalCount))),
    lostTotal: lost.reduce((a, b) => a + b, 0),
    trialsWithLoss: lost.filter((l) => l > 0).length,
    lostMean: round2(mean(lost)),
    retriesMean: round2(mean(results.map((r) => r.retries))),
    errorsTotal: results.reduce((a, r) => a + r.errors, 0),
    p50Median: round2(median(results.map((r) => r.p50Ms))),
    p95Median: round2(median(results.map((r) => r.p95Ms))),
    throughputMean: round2(mean(results.map((r) => r.throughputRps))),
  };
}

/** Runs `req.trials` trials of one lost-update variant, persisting each to experiment_run. */
export async function runLostUpdateExperiment(
  req: LostUpdateExperimentRequest,
): Promise<{ batchId: string; trials: LostUpdateTrialResult[]; aggregate: LostUpdateAggregate }> {
  validate(req);
  if (req.trials < 1 || req.trials > 20) throw new LostUpdateParamError('trials must be between 1 and 20');
  const batchId = req.batchId ?? crypto.randomUUID();

  return withLabLock(async () => {
    const trials: LostUpdateTrialResult[] = [];
    for (let trial = 1; trial <= req.trials; trial++) {
      const result = await runLostUpdate(req);
      const runId = await saveRun({
        experiment: 'LOST_UPDATE', strategy: req.variant, isolationLevel: result.isolationUsed,
        mode: 'NORMAL', concurrency: req.increments, accounts: 1, maxStreams: 1, raceDelayMs: req.raceDelayMs,
        granted: result.succeeded, rejected: 0, retries: result.retries, deadlocks: result.deadlocks,
        lockTimeouts: 0, errors: result.errors, violations: result.lost, p50Ms: result.p50Ms, p95Ms: result.p95Ms,
        throughputRps: result.throughputRps, wallMs: result.wallMs, batchId, trial, source: req.source,
        detail: { finalCount: result.finalCount },
      });
      trials.push({ ...result, runId, trial, batchId });
    }
    return { batchId, trials, aggregate: aggregateLostUpdate(req.variant, trials) };
  });
}
