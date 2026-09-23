import type { PoolConnection } from 'mysql2/promise';
import { isDeadlock, isLockWaitTimeout } from './errors.js';

export type Isolation = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
export const ISOLATIONS: readonly Isolation[] = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'];

export interface Stats { retries: number; deadlocks: number; lockTimeouts: number }
export const newStats = (): Stats => ({ retries: 0, deadlocks: 0, lockTimeouts: 0 });

/** Thrown by the OPTIMISTIC strategy when its compare-and-set validation fails. Retryable. */
export class OccConflictError extends Error {
  constructor(message = 'optimistic validation failed: state_version changed') {
    super(message);
    this.name = 'OccConflictError';
  }
}

/**
 * Runs `fn` inside one transaction at the given isolation level.
 * `SET TRANSACTION ISOLATION LEVEL` (without SESSION) applies to the next transaction only,
 * so the pooled connection keeps its default for whoever uses it next.
 * On any error: ROLLBACK and rethrow. The caller owns (and releases) the connection.
 */
export async function withTx<T>(conn: PoolConnection, isolation: Isolation, fn: () => Promise<T>): Promise<T> {
  if (!ISOLATIONS.includes(isolation)) throw new Error(`bad isolation level: ${isolation}`);
  await conn.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
  await conn.query('START TRANSACTION');
  try {
    const result = await fn();
    await conn.query('COMMIT');
    return result;
  } catch (err) {
    // After a deadlock InnoDB has already rolled back; after a 1205 lock-wait timeout only the
    // statement was rolled back (innodb_rollback_on_timeout=OFF), so this ROLLBACK matters.
    await conn.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

export interface RetryOptions { max?: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-runs `fn` when the failure means "someone else won the conflict, try again":
 * deadlock victim (1213), lock-wait timeout (1205) or an optimistic validation failure.
 * Exponential backoff 5 → 80 ms with jitter, so retrying transactions don't collide in lockstep.
 */
export async function withRetry<T>(fn: () => Promise<T>, stats: Stats, { max = 5 }: RetryOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const deadlock = isDeadlock(err);
      const timeout = isLockWaitTimeout(err);
      const occ = err instanceof OccConflictError;
      if (!deadlock && !timeout && !occ) throw err;
      if (deadlock) stats.deadlocks++;
      if (timeout) stats.lockTimeouts++;
      if (attempt >= max) throw err;
      stats.retries++;
      const base = Math.min(80, 5 * 2 ** attempt);
      await sleep(base * (0.5 + Math.random()));
    }
  }
}

export { sleep };
