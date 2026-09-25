// Ground truth for the simulation: SQL over the simulation's own accounts, never client counters.
import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { bumpVersion } from '../../services/accountState.js';
import { writeEvent } from '../../strategies/common.js';

export interface AccountTruth { accountId: number; max: number; active: number }

/** Active (PLAYING with an unexpired lease) sessions vs the limit, for each account, right now. */
export async function readTruth(accountIds: number[]): Promise<AccountTruth[]> {
  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT a.account_id, a.max_streams, COUNT(s.session_id) AS active
     FROM account a
     LEFT JOIN playback_session s
       ON s.account_id = a.account_id AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3)
     WHERE a.account_id IN (?)
     GROUP BY a.account_id, a.max_streams`,
    [accountIds]);
  const byId = new Map(rows.map((r) => [Number(r.account_id), { max: Number(r.max_streams), active: Number(r.active) }]));
  return accountIds.map((id) => ({ accountId: id, max: byId.get(id)?.max ?? 0, active: byId.get(id)?.active ?? 0 }));
}

export interface RepairedHousehold { accountId: number; ended: { sessionId: number; deviceId: number }[] }

/**
 * Repair: for one account, ends the newest excess sessions so it is back within its limit.
 * One transaction, global lock order (account first, then sessions, then events).
 */
export async function repairAccount(accountId: number): Promise<RepairedHousehold | null> {
  const conn = await appPool.getConnection();
  try {
    return await withTx(conn, 'READ COMMITTED', async () => {
      const [acct] = await conn.query<RowDataPacket[]>(
        'SELECT max_streams FROM account WHERE account_id = ? FOR UPDATE', [accountId]);
      const max = Number(acct[0]?.max_streams ?? 0);
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT session_id, device_id FROM playback_session
         WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3)
         ORDER BY started_at DESC, session_id DESC`, [accountId]);
      const excess = rows.length - max;
      if (excess <= 0) return null;
      const victims = rows.slice(0, excess).map((r) => ({ sessionId: Number(r.session_id), deviceId: r.device_id as number }));
      await conn.query(
        `UPDATE playback_session SET status = 'ENDED', ended_at = NOW(3) WHERE session_id IN (?) AND status = 'PLAYING'`,
        [victims.map((v) => v.sessionId)]);
      const stateVersion = await bumpVersion(conn, accountId);
      for (const v of victims) {
        await writeEvent(conn, { accountId, deviceId: v.deviceId, sessionId: v.sessionId, type: 'RELEASED',
          stateVersion, detail: { by: 'repair' } });
      }
      return { accountId, ended: victims };
    });
  } finally {
    conn.release();
  }
}
