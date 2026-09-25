// Index experiment (Phase 6): how the composite index changes the LOCK footprint, not just the speed.
//
// For each of {both indexes, without ix_session_account_status_lease, without any usable index} it
//   1. shows EXPLAIN and EXPLAIN ANALYZE of the "active count" query,
//   2. runs the CONSTRAINT strategy's expire UPDATE for ONE account inside a REPEATABLE READ
//      transaction and counts the InnoDB locks that transaction holds (performance_schema.data_locks),
//   3. from a second connection tries the same UPDATE for a DIFFERENT account with a 1 s lock-wait
//      timeout: without the index it blocks, because InnoDB locks every index record it scans.
// The table is loaded with ~20,000 historical ENDED sessions plus one lapsed PLAYING session per
// account (tagged strategy IDXHIST / IDXLAB and always removed). The index is always restored.

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { appPool } from '../db/pool.js';
import { errnoOf, ER_LOCK_WAIT_TIMEOUT } from '../db/errors.js';
import { withLabLock } from './labLock.js';

const INDEX = 'ix_session_account_status_lease';
const STATUS_INDEX = 'ix_session_status_lease';
const HIST_ROWS_PER_DEVICE = 20;

export interface IndexVariant {
  variant: 'WITH_INDEX' | 'WITHOUT_COMPOSITE' | 'WITHOUT_ANY_INDEX';
  explain: { key: string | null; type: string | null; rows: number | null; extra: string | null };
  explainAnalyze: string;
  countMs: number;
  locksHeld: number;
  recordLocks: number;
  tableLocks: number;
  otherAccountBlocked: boolean;
  otherAccountMs: number;
}

export interface IndexExperimentResult {
  historyRows: number;
  accountsTouched: number;
  variants: IndexVariant[];
  finding: string;
}

const ACTIVE_COUNT = `SELECT COUNT(*) AS n FROM playback_session WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3)`;
const EXPIRE = `UPDATE playback_session SET status = 'EXPIRED', ended_at = lease_expires_at
                WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at <= NOW(3)`;

async function indexPresent(conn: PoolConnection, name = INDEX): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'playback_session' AND index_name = ?`, [name]);
  return Number(rows[0]!.n) > 0;
}

async function seed(conn: PoolConnection, accountIds: number[]): Promise<number> {
  await conn.query(
    `INSERT INTO playback_session (account_id, device_id, song_id, status, position_ms, started_at, lease_expires_at, ended_at, strategy)
     WITH RECURSIVE n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     SELECT d.account_id, d.device_id, 1, 'ENDED', 0, NOW(3) - INTERVAL n.i HOUR, NOW(3) - INTERVAL n.i HOUR, NOW(3) - INTERVAL n.i HOUR, 'IDXHIST'
     FROM device d JOIN n WHERE d.account_id IN (?)`, [HIST_ROWS_PER_DEVICE, accountIds]);
  // One lapsed PLAYING session per account: what the expire UPDATE looks for.
  await conn.query(
    `INSERT INTO playback_session (account_id, device_id, song_id, status, position_ms, started_at, lease_expires_at, strategy)
     SELECT account_id, MIN(device_id), 1, 'PLAYING', 0, NOW(3) - INTERVAL 2 MINUTE, NOW(3) - INTERVAL 1 MINUTE, 'IDXLAB'
     FROM device WHERE account_id IN (?) GROUP BY account_id`, [accountIds]);
  const [c] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM playback_session WHERE strategy IN ('IDXHIST','IDXLAB')`);
  return Number(c[0]!.n);
}

async function measure(variant: IndexVariant['variant'], target: number, other: number): Promise<IndexVariant> {
  const a = await appPool.getConnection();
  const b = await appPool.getConnection();
  const admin = await appPool.getConnection();
  try {
    const [plan] = await a.query<RowDataPacket[]>(`EXPLAIN ${ACTIVE_COUNT.replace('?', String(target))}`);
    const p: RowDataPacket = plan[0] ?? ({} as RowDataPacket);
    const [an] = await a.query<RowDataPacket[]>(`EXPLAIN ANALYZE ${ACTIVE_COUNT.replace('?', String(target))}`);
    const t0 = process.hrtime.bigint();
    await a.query(ACTIVE_COUNT, [target]);
    const countMs = Number(process.hrtime.bigint() - t0) / 1e6;

    await a.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await a.query('START TRANSACTION');
    await a.query(EXPIRE, [target]);
    const [idRows] = await a.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
    const connId = Number(idRows[0]!.id);
    const [locks] = await admin.query<RowDataPacket[]>(
      `SELECT l.LOCK_TYPE AS t, COUNT(*) AS n FROM performance_schema.data_locks l
       JOIN performance_schema.threads th ON th.THREAD_ID = l.THREAD_ID
       WHERE th.PROCESSLIST_ID = ? AND l.OBJECT_NAME = 'playback_session' GROUP BY l.LOCK_TYPE`, [connId]);
    const count = (t: string) => Number(locks.find((r) => r.t === t)?.n ?? 0);

    await b.query('SET SESSION innodb_lock_wait_timeout = 1');
    await b.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await b.query('START TRANSACTION');
    const s0 = process.hrtime.bigint();
    let blocked = false;
    try { await b.query(EXPIRE, [other]); } catch (err) { if (errnoOf(err) === ER_LOCK_WAIT_TIMEOUT) blocked = true; else throw err; }
    const otherMs = Number(process.hrtime.bigint() - s0) / 1e6;
    await b.query('ROLLBACK');
    await a.query('ROLLBACK');
    await b.query('SET SESSION innodb_lock_wait_timeout = DEFAULT');

    return {
      variant,
      explain: { key: p.key ?? null, type: p.type ?? null, rows: p.rows ?? null, extra: p.Extra ?? null },
      explainAnalyze: String(Object.values(an[0] ?? {})[0] ?? '').trim(),
      countMs: Math.round(countMs * 100) / 100,
      locksHeld: count('RECORD') + count('TABLE'), recordLocks: count('RECORD'), tableLocks: count('TABLE'),
      otherAccountBlocked: blocked, otherAccountMs: Math.round(otherMs),
    };
  } finally {
    await a.query('ROLLBACK').catch(() => undefined);
    await b.query('ROLLBACK').catch(() => undefined);
    a.release(); b.release(); admin.release();
  }
}

export function runIndexExperiment(): Promise<IndexExperimentResult> {
  return withLabLock(async () => {
    const conn = await appPool.getConnection();
    let hadIndex = false;
    try {
      const [acc] = await conn.query<RowDataPacket[]>('SELECT account_id FROM account WHERE is_lab = TRUE ORDER BY account_id');
      const accountIds = acc.map((r) => Number(r.account_id));
      const [target, other] = [accountIds[0]!, accountIds[1]!];
      await conn.query('DELETE FROM playback_event WHERE account_id IN (?)', [accountIds]);
      await conn.query('DELETE FROM playback_session WHERE account_id IN (?)', [accountIds]);
      hadIndex = await indexPresent(conn);
      if (!hadIndex) await conn.query(`ALTER TABLE playback_session ADD INDEX ${INDEX} (account_id, status, lease_expires_at)`);
      const historyRows = await seed(conn, accountIds);

      const withIdx = await measure('WITH_INDEX', target, other);
      await conn.query(`ALTER TABLE playback_session DROP INDEX ${INDEX}`);
      const without = await measure('WITHOUT_COMPOSITE', target, other);
      await conn.query(`ALTER TABLE playback_session DROP INDEX ${STATUS_INDEX}`);
      const bare = await measure('WITHOUT_ANY_INDEX', target, other);

      const finding = `One account's expire UPDATE held ${withIdx.locksHeld} InnoDB locks with the composite index, ${without.locksHeld} without it`
        + ` and ${bare.locksHeld} with no usable index`
        + (without.otherAccountBlocked || bare.otherAccountBlocked ? '; without the composite index a DIFFERENT account\'s identical UPDATE was blocked (lock wait timeout).' : '.');
      return { historyRows, accountsTouched: accountIds.length, variants: [withIdx, without, bare], finding };
    } finally {
      await conn.query('ROLLBACK').catch(() => undefined);
      if (!(await indexPresent(conn).catch(() => true))) {
        await conn.query(`ALTER TABLE playback_session ADD INDEX ${INDEX} (account_id, status, lease_expires_at)`).catch((e) => console.error('index restore failed', e));
      }
      if (!(await indexPresent(conn, STATUS_INDEX).catch(() => true))) {
        await conn.query(`ALTER TABLE playback_session ADD INDEX ${STATUS_INDEX} (status, lease_expires_at)`).catch((e) => console.error('index restore failed', e));
      }
      await conn.query(`DELETE FROM playback_session WHERE strategy IN ('IDXHIST', 'IDXLAB')`).catch(() => undefined);
      conn.release();
    }
  });
}
