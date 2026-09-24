// Lock inspector (PLAN.md §8.3). The two queries are taken verbatim from the plan.

import type { Connection, Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TxnLabel } from './types.js';

type Queryable = Connection | Pool | PoolConnection;

export interface LockRow {
  connId: number; label: TxnLabel | 'other';
  table: string; index: string | null;
  type: string; mode: string; status: 'GRANTED' | 'WAITING'; data: string | null;
}
export interface WaitRow { waitingConn: number; waitingLabel: TxnLabel | 'other'; blockingConn: number; blockingLabel: TxnLabel | 'other' }
export interface LockSnapshot { locks: LockRow[]; waits: WaitRow[]; cycle: boolean }

export async function readLocks(admin: Queryable, connToLabel: (connId: number) => TxnLabel | 'other'): Promise<LockSnapshot> {
  const [lockRows] = await admin.query<RowDataPacket[]>(
    `SELECT t.PROCESSLIST_ID AS conn_id, l.OBJECT_NAME, l.INDEX_NAME,
            l.LOCK_TYPE, l.LOCK_MODE, l.LOCK_STATUS, l.LOCK_DATA
     FROM performance_schema.data_locks l
     JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
     WHERE l.OBJECT_SCHEMA = 'playsync'`,
  );
  const [waitRows] = await admin.query<RowDataPacket[]>(
    `SELECT rt.PROCESSLIST_ID AS waiting_conn, bt.PROCESSLIST_ID AS blocking_conn
     FROM performance_schema.data_lock_waits w
     JOIN performance_schema.threads rt ON rt.THREAD_ID = w.REQUESTING_THREAD_ID
     JOIN performance_schema.threads bt ON bt.THREAD_ID = w.BLOCKING_THREAD_ID`,
  );

  const locks: LockRow[] = lockRows.map((r) => ({
    connId: r.conn_id, label: connToLabel(r.conn_id),
    table: r.OBJECT_NAME, index: r.INDEX_NAME,
    type: r.LOCK_TYPE, mode: r.LOCK_MODE, status: r.LOCK_STATUS, data: r.LOCK_DATA,
  }));
  const waits: WaitRow[] = waitRows.map((r) => ({
    waitingConn: r.waiting_conn, waitingLabel: connToLabel(r.waiting_conn),
    blockingConn: r.blocking_conn, blockingLabel: connToLabel(r.blocking_conn),
  }));
  // A wait-for cycle: T1 waits for T2 AND T2 waits for T1. InnoDB resolves it almost immediately,
  // so the UI may only observe this for a moment - the deadlock banner covers the aftermath.
  const cycle = waits.some((w) => w.waitingLabel === 'T1' && w.blockingLabel === 'T2')
    && waits.some((w) => w.waitingLabel === 'T2' && w.blockingLabel === 'T1');

  return { locks, waits, cycle };
}
