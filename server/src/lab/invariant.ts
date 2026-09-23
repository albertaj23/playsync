import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export interface InvariantBreach { accountId: number; maxStreams: number; active: number }

/**
 * The invariant: for every account, active (PLAYING + unexpired lease) sessions ≤ max_streams.
 * Returns the accounts that break it; violations = Σ(active − max_streams).
 * Pass `accountIds` to check specific accounts, otherwise all lab accounts are checked.
 */
export async function checkInvariant(db: Pool | PoolConnection, accountIds?: number[]) {
  const filter = accountIds?.length ? 'a.account_id IN (?)' : 'a.is_lab = TRUE';
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT a.account_id, a.max_streams, COUNT(*) AS active
     FROM account a
     JOIN playback_session s
       ON s.account_id = a.account_id AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3)
     WHERE ${filter}
     GROUP BY a.account_id, a.max_streams
     HAVING COUNT(*) > a.max_streams`,
    accountIds?.length ? [accountIds] : [],
  );
  const breaches: InvariantBreach[] = rows.map((r) => ({
    accountId: r.account_id, maxStreams: r.max_streams, active: Number(r.active),
  }));
  return { breaches, violations: breaches.reduce((sum, b) => sum + b.active - b.maxStreams, 0) };
}
