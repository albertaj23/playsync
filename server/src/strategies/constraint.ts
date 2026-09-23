// CONSTRAINT: let a UNIQUE index enforce "one PLAYING session per account".
//
//   active_account_id = IF(status = 'PLAYING', account_id, NULL)   (stored generated column)
//   UNIQUE INDEX uq_one_active_per_account (active_account_id)       (NULLs never collide)
//
//   expire this account's lapsed PLAYING rows → (TAKEOVER: preempt) → INSERT
//   → ER_DUP_ENTRY (1062) on uq_one_active_per_account = someone else is playing.
//
// PREVENTS write skew declaratively: the second INSERT of the same key waits on the first's
// uncommitted index entry, then fails (or succeeds if the first rolled back).
// LIMITS: can only express max_streams = 1 (no "≤ N" unique index, no SQL ASSERTION in MySQL),
// and lapsed rows must be expired before the INSERT or they would still hold the key.
// LOCK ORDER: touches playback_session before account (the version bump), unlike the reaper,
// so claim/reaper deadlocks are possible; withRetry absorbs them and the lab reports them.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { OccConflictError, withRetry, withTx } from '../db/tx.js';
import { isDupEntry } from '../db/errors.js';
import type { ClaimResult, Strategy } from './types.js';
import { grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const UNIQUE_INDEX = 'uq_one_active_per_account';

class SlotTaken extends Error {}

export const constraint: Strategy = {
  name: 'CONSTRAINT',
  defaultIsolation: 'READ COMMITTED',
  supportsMaxStreamsAbove1: false,
  needsUniqueIndex: true,
  async claim(conn, input, stats) {
    try {
      return await withRetry(() => withTx(conn, input.isolation ?? 'READ COMMITTED', async (): Promise<ClaimResult> => {
        await conn.query<ResultSetHeader>(
          `UPDATE playback_session SET status = 'EXPIRED', ended_at = lease_expires_at
           WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at <= NOW(3)`,
          [input.accountId],
        );
        const toPreempt = input.mode === 'TAKEOVER'
          ? await oldestActive(conn, input.accountId, input.deviceId, 1000)
          : [];
        await raceDelay(input);
        try {
          return await grant(conn, input, { strategy: 'CONSTRAINT', toPreempt });
        } catch (err) {
          if (!isDupEntry(err) || !String((err as Error).message).includes(UNIQUE_INDEX)) throw err;
          // TAKEOVER lost a race to another claim that inserted after our preempt: retry, which
          // will preempt that newer session too. NORMAL: the slot is taken → reject.
          if (input.mode === 'TAKEOVER') throw new OccConflictError('slot taken during takeover');
          throw new SlotTaken();   // roll back our expire/end-device updates before rejecting
        }
      }), stats);
    } catch (err) {
      if (!(err instanceof SlotTaken)) throw err;
      return withTx(conn, 'READ COMMITTED', async () =>
        reject(conn, input, (await readAccount(conn, input.accountId)).stateVersion));
    }
  },
};

/** Adds or drops the unique index. Only the CONSTRAINT strategy may run with it present. */
export async function setUniqueIndex(conn: PoolConnection, present: boolean): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'playback_session' AND index_name = ?`,
    [UNIQUE_INDEX],
  );
  const exists = Number(rows[0]!.n) > 0;
  if (present && !exists) {
    // Lapsed PLAYING rows would collide on the new index; they are expired anyway.
    await conn.query(
      `UPDATE playback_session SET status = 'EXPIRED', ended_at = lease_expires_at
       WHERE status = 'PLAYING' AND lease_expires_at <= NOW(3)`,
    );
    await conn.query(`ALTER TABLE playback_session ADD UNIQUE INDEX ${UNIQUE_INDEX} (active_account_id)`);
  } else if (!present && exists) {
    await conn.query(`ALTER TABLE playback_session DROP INDEX ${UNIQUE_INDEX}`);
  }
}
