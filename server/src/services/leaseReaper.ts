// Lease reaper (PLAN.md §6.6). Marks lapsed PLAYING sessions EXPIRED so the UI stays truthful.
//
// It is NOT what makes claims correct: every claim already treats a lapsed lease as inactive
// ("active" = PLAYING AND lease_expires_at > NOW(3)), and a heartbeat can never revive one.
// Lab accounts AND the Transaction Stepper's accounts (step_a, step_b) are skipped so the reaper
// never takes account locks or expires sessions in the middle of an experiment/demo (race runs
// reset lab accounts themselves; CONSTRAINT expires its own stale rows; the stepper's invariant
// panel must still see the sessions its transactions committed after their 15 s lease).

import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from '../db/pool.js';
import { withTx } from '../db/tx.js';
import { publish } from '../realtime/publisher.js';
import { writeEvent } from '../strategies/common.js';
import { bumpVersion } from './accountState.js';

export interface ReapResult { accountId: number; expired: { sessionId: number; deviceId: number }[]; stateVersion: number }

/** One pass over all accounts with lapsed leases. Returns what was expired (for tests and logs). */
export async function reapOnce(): Promise<ReapResult[]> {
  // 1. Which accounts have lapsed PLAYING sessions? Uses ix_session_status_lease.
  const [accounts] = await appPool.query<RowDataPacket[]>(
    `SELECT DISTINCT s.account_id FROM playback_session s JOIN account a ON a.account_id = s.account_id
     WHERE s.status = 'PLAYING' AND s.lease_expires_at <= NOW(3) AND a.is_lab = FALSE
       AND a.username NOT IN ('step_a', 'step_b')`);

  const results: ReapResult[] = [];
  for (const { account_id: accountId } of accounts) {
    const conn = await appPool.getConnection();
    try {
      // 2. One READ COMMITTED transaction per account, in global lock order: account → session → event.
      const r = await withTx(conn, 'READ COMMITTED', async () => {
        await conn.query('SELECT account_id FROM account WHERE account_id = ? FOR UPDATE', [accountId]);
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT session_id, device_id FROM playback_session
           WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at <= NOW(3) FOR UPDATE`, [accountId]);
        if (rows.length === 0) return null;   // someone else (a claim, another reaper pass) got there first
        await conn.query(
          `UPDATE playback_session SET status = 'EXPIRED', ended_at = lease_expires_at WHERE session_id IN (?)`,
          [rows.map((x) => x.session_id)]);
        const stateVersion = await bumpVersion(conn, accountId);
        const expired = rows.map((x) => ({ sessionId: Number(x.session_id), deviceId: x.device_id as number }));
        for (const e of expired) {
          await writeEvent(conn, { accountId, deviceId: e.deviceId, sessionId: e.sessionId, type: 'EXPIRED', stateVersion });
        }
        return { accountId, expired, stateVersion };
      });
      if (!r) continue;
      results.push(r);
      // 3. After COMMIT: push the snapshot and tell each device its session is gone.
      publish().accountChanged(accountId);
      for (const e of r.expired) publish().sessionLost(e.deviceId, { sessionId: e.sessionId, reason: 'EXPIRED' });
    } catch (err) {
      console.error(`reaper: account ${accountId} failed`, err);
    } finally {
      conn.release();
    }
  }
  return results;
}

/** Runs reapOnce every `intervalMs`, never overlapping two passes. Returns a stop function. */
export function startReaper(intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    reapOnce().catch((err) => console.error('reaper pass failed', err)).finally(() => { running = false; });
  }, intervalMs);
  return () => clearInterval(timer);
}
