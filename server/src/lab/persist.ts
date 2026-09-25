// Persistence for experiment_run: one row per trial, shared by the STREAM_LIMIT and LOST_UPDATE
// experiments. Keeping the insert and the read-back types in one place means the two experiment
// runners and the /lab/runs route agree on column names and JS/SQL type conversions.

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { appPool } from '../db/pool.js';

export type RunSource = 'UI' | 'API' | 'BENCH' | 'TEST' | 'SIM';
export type RunExperiment = 'STREAM_LIMIT' | 'LOST_UPDATE';
export type RunMode = 'NORMAL' | 'TAKEOVER';

export interface RunRow {
  experiment: RunExperiment;
  strategy: string;              // StrategyName for STREAM_LIMIT, LostUpdateVariant for LOST_UPDATE
  isolationLevel: string;
  mode: RunMode;
  concurrency: number;
  accounts: number;
  maxStreams: number;
  raceDelayMs: number;
  granted: number;
  rejected: number;
  retries: number;
  deadlocks: number;
  lockTimeouts: number;
  errors: number;
  violations: number;
  p50Ms: number;
  p95Ms: number;
  throughputRps: number;
  wallMs: number;
  batchId: string;
  trial: number;
  source: RunSource;
  detail?: unknown;
}

/** Inserts one experiment_run row and returns its run_id. */
export async function saveRun(row: RunRow): Promise<number> {
  const [res] = await appPool.query<ResultSetHeader>(
    `INSERT INTO experiment_run
       (experiment, strategy, isolation_level, mode, concurrency, accounts, max_streams, race_delay_ms,
        granted, rejected, retries, deadlocks, lock_timeouts, errors, violations,
        p50_ms, p95_ms, throughput_rps, wall_ms, batch_id, trial, source, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.experiment, row.strategy, row.isolationLevel, row.mode, row.concurrency, row.accounts,
      row.maxStreams, row.raceDelayMs, row.granted, row.rejected, row.retries, row.deadlocks,
      row.lockTimeouts, row.errors, row.violations, row.p50Ms, row.p95Ms, row.throughputRps,
      row.wallMs, row.batchId, row.trial, row.source,
      row.detail === undefined ? null : JSON.stringify(row.detail),
    ],
  );
  return res.insertId;
}

export interface StoredRun {
  runId: number; experiment: RunExperiment; strategy: string; isolationLevel: string; mode: RunMode;
  concurrency: number; accounts: number; maxStreams: number; raceDelayMs: number;
  granted: number; rejected: number; retries: number; deadlocks: number; lockTimeouts: number;
  errors: number; violations: number; p50Ms: number; p95Ms: number; throughputRps: number; wallMs: number;
  batchId: string | null; trial: number; source: RunSource; detail: unknown; createdAt: string;
}

export interface RunQuery {
  experiment?: RunExperiment;
  batchId?: string;
  strategy?: string;
  limit: number;
}

/**
 * Reads experiment_run rows, newest first. DECIMAL columns (p50_ms, p95_ms, throughput_rps,
 * wall_ms) come back from mysql2 as strings, not numbers - converted here so every caller gets
 * real numbers.
 */
export async function listRuns(q: RunQuery): Promise<StoredRun[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.experiment) { where.push('experiment = ?'); params.push(q.experiment); }
  if (q.batchId) { where.push('batch_id = ?'); params.push(q.batchId); }
  if (q.strategy) { where.push('strategy = ?'); params.push(q.strategy); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(q.limit);

  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT run_id, experiment, strategy, isolation_level, mode, concurrency, accounts, max_streams,
            race_delay_ms, granted, rejected, retries, deadlocks, lock_timeouts, errors, violations,
            p50_ms, p95_ms, throughput_rps, wall_ms, batch_id, trial, source, detail, created_at
     FROM experiment_run ${whereSql}
     ORDER BY run_id DESC LIMIT ?`,
    params,
  );
  return rows.map((r) => ({
    runId: Number(r.run_id), experiment: r.experiment, strategy: r.strategy, isolationLevel: r.isolation_level,
    mode: r.mode, concurrency: r.concurrency, accounts: r.accounts, maxStreams: r.max_streams,
    raceDelayMs: r.race_delay_ms, granted: r.granted, rejected: r.rejected, retries: r.retries,
    deadlocks: r.deadlocks, lockTimeouts: r.lock_timeouts, errors: r.errors, violations: r.violations,
    p50Ms: Number(r.p50_ms), p95Ms: Number(r.p95_ms), throughputRps: Number(r.throughput_rps),
    wallMs: Number(r.wall_ms), batchId: r.batch_id, trial: r.trial, source: r.source, detail: r.detail,
    createdAt: r.created_at,
  }));
}
