// TRIGGER: a BEFORE INSERT trigger on playback_session counts the account's active sessions and
// SIGNALs (SQLSTATE 45000) when the limit is reached. It LOOKS airtight (the check lives in the
// database and runs for every insert) and it is MOSTLY safe, but not guaranteed.
//
// Measured (docs in README section 8.5): a SELECT inside a trigger runs with the locking semantics of
// the invoking INSERT, not as a snapshot read. At READ COMMITTED it takes shared record locks, so a
// racer whose trigger runs after another's insert WAITS on that uncommitted row and then correctly
// sees it. There are no gap locks at READ COMMITTED though, so two triggers that both count BEFORE
// either row exists still both pass and both insert. That window is tiny, so violations are rare
// (roughly 1 in 10 trials at 32-way concurrency) and come with deadlocks: an "it looks safe" strategy
// that a real invariant check still catches. Like the unique index, the trigger exists only while this
// strategy is in use (artifacts.ts), otherwise it would half-protect the other strategies.
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ER_SIGNAL, errnoOf } from '../db/errors.js';
import { withRetry, withTx } from '../db/tx.js';
import type { ClaimResult, Strategy } from './types.js';
import { grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const TRIGGER_NAME = 'trg_limit_active_sessions';

class LimitSignal extends Error {}

export const trigger: Strategy = {
  name: 'TRIGGER',
  defaultIsolation: 'READ COMMITTED',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  async claim(conn, input, stats) {
    try {
      return await withRetry(() => withTx(conn, input.isolation ?? 'READ COMMITTED', async (): Promise<ClaimResult> => {
        // NORMAL: no count in the application at all; the trigger decides. TAKEOVER preempts first.
        const toPreempt = input.mode === 'TAKEOVER' ? await oldestActive(conn, input.accountId, input.deviceId, 1000) : [];
        await raceDelay(input);
        try {
          return await grant(conn, input, { strategy: 'TRIGGER', toPreempt });
        } catch (err) {
          if (errnoOf(err) === ER_SIGNAL) throw new LimitSignal();
          throw err;
        }
      }), stats);
    } catch (err) {
      if (!(err instanceof LimitSignal)) throw err;
      return withTx(conn, 'READ COMMITTED', async () => reject(conn, input, (await readAccount(conn, input.accountId)).stateVersion));
    }
  },
};

/** Installs or removes the trigger. Only the TRIGGER strategy may run with it present. */
export async function setTrigger(conn: PoolConnection, present: boolean): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = ?`, [TRIGGER_NAME]);
  const exists = Number(rows[0]!.n) > 0;
  if (present && !exists) {
    await conn.query(
      `CREATE TRIGGER ${TRIGGER_NAME} BEFORE INSERT ON playback_session FOR EACH ROW
       BEGIN
         IF NEW.status = 'PLAYING' AND
            (SELECT COUNT(*) FROM playback_session s
             WHERE s.account_id = NEW.account_id AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3) AND s.device_id <> NEW.device_id)
            >= (SELECT max_streams FROM account WHERE account_id = NEW.account_id) THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stream limit reached';
         END IF;
       END`);
  } else if (!present && exists) {
    await conn.query(`DROP TRIGGER ${TRIGGER_NAME}`);
  }
}
