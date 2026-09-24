// Generic MySQL advisory (named) lock helper, shared by the Concurrency Lab and the Transaction
// Stepper. A named lock is visible to every connection to this database, from any process, so it
// coordinates across the UI, the CLI bench and the test suite - something an in-process flag
// can't do. It's also a nice extra DB concept for the report: advisory locking via
// GET_LOCK/RELEASE_LOCK, independent of any table or row.

import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from './pool.js';

/** Thrown when another session already holds the named lock. */
export class NamedLockBusyError extends Error {
  constructor(readonly lockName: string, message: string) {
    super(message);
    this.name = 'NamedLockBusyError';
  }
}

/**
 * Runs `fn` while holding GET_LOCK(name, 0). Throws NamedLockBusyError immediately (timeout 0) if
 * another session holds it, rather than queuing - each of these locks protects "one thing at a
 * time", not a wait list.
 *
 * The lock is tied to the connection's session: if this process crashes or the connection drops,
 * MySQL releases it automatically, so a stuck lock can't survive a crash. We still always
 * RELEASE_LOCK explicitly in `finally` for the normal case.
 *
 * The lock connection is taken from `appPool`, never `labPool`: holding a lab-pool connection for
 * the whole operation would shrink the pool an in-flight race itself needs and could starve it.
 */
export async function withNamedLock<T>(name: string, busyMessage: string, fn: () => Promise<T>): Promise<T> {
  const conn = await appPool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [name]);
    const got = rows[0]?.got;
    if (got !== 1) {
      conn.release();
      throw new NamedLockBusyError(name, busyMessage);
    }
  } catch (err) {
    if (err instanceof NamedLockBusyError) throw err;
    conn.release();
    throw err;
  }

  try {
    return await fn();
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined);
    conn.release();
  }
}
