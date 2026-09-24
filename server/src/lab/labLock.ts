// Cross-process mutex for the Concurrency Lab, using a MySQL named lock.
//
// The in-process 'running' flag (Phase 3) only stopped two requests within THIS process from
// overlapping. It couldn't stop the CLI bench (a separate process) or the test suite from
// resetting the same lab accounts and toggling the same unique index while the UI (or the bench,
// or the tests) was mid-experiment. A MySQL named lock is visible to every connection to this
// database, from any process, so it closes that gap - and it's a nice extra DB concept to have
// in the report (advisory locking via GET_LOCK/RELEASE_LOCK, independent of any table).

import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from '../db/pool.js';

const LOCK_NAME = 'playsync.lab';

/** Thrown when another process or request already holds the lab lock. */
export class LabBusyError extends Error {
  constructor() {
    super('another experiment is running (UI, bench or tests)');
    this.name = 'LabBusyError';
  }
}

/**
 * Runs `fn` while holding GET_LOCK('playsync.lab'). Throws LabBusyError immediately (timeout 0)
 * if another process/request holds it, rather than queuing - the lab has one experiment at a
 * time, not a wait list.
 *
 * The lock is tied to the connection's session: if this process crashes or the connection drops,
 * MySQL releases it automatically, so a stuck lock can't survive a crash. We still always
 * RELEASE_LOCK explicitly in `finally` for the normal case.
 *
 * The lock connection is taken from `appPool`, never `labPool`: holding a lab-pool connection
 * for the whole experiment would shrink the pool the race itself needs and could starve it.
 */
export async function withLabLock<T>(fn: () => Promise<T>): Promise<T> {
  const conn = await appPool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME],
    );
    const got = rows[0]?.got;
    if (got !== 1) {
      conn.release();
      throw new LabBusyError();
    }
  } catch (err) {
    if (err instanceof LabBusyError) throw err;
    conn.release();
    throw err;
  }

  try {
    return await fn();
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => undefined);
    conn.release();
  }
}
