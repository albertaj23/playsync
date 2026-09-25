// REDIS_LEASE: the stream limit is enforced by a key-value store instead of by SQL. Each account has
// `max_streams` slot keys; a claim atomically takes a slot with SET NX PX <lease> (one Lua script), so
// the LIMIT can never be exceeded no matter how many claims race: Redis is single-threaded and the
// script is atomic. MySQL still stores the session and the audit event (so the invariant query and
// the UI keep working); Redis is the gatekeeper in front.
//
// Trade-offs this strategy exists to show (NoSQL / CAP discussion):
//  * correctness comes from an atomic primitive, not from transactions across two systems;
//  * the two stores can disagree (a crash between "won the slot" and "session inserted" leaks a slot
//    until its TTL, handled here by releasing the slot on failure);
//  * a single Redis node is not partition-tolerant as a lock service (CP vs AP is not a choice we made:
//    if Redis is unreachable the claim fails closed).
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withRetry, withTx } from '../db/tx.js';
import { acquireSlot, freeSlots } from '../db/redis.js';
import { config } from '../config.js';
import type { ClaimResult, Strategy } from './types.js';
import { bumpVersion } from '../services/accountState.js';
import { grant, raceDelay, readAccount, reject, writeEvent } from './common.js';

/**
 * TAKEOVER reconciliation. Stealing a slot is atomic in Redis, but the victim's MySQL session may not
 * exist yet (its claim is still in flight), so the preempt found nothing. After our own session is
 * committed we therefore trim any excess: preempt the oldest other active sessions beyond the limit.
 * This is the price of two stores: admission is atomic, preemption is eventually consistent.
 */
async function reconcile(conn: PoolConnection, accountId: number, ownDeviceId: number, max: number): Promise<number[]> {
  return withTx(conn, 'READ COMMITTED', async () => {
    await conn.query('SELECT account_id FROM account WHERE account_id = ? FOR UPDATE', [accountId]);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT session_id, device_id FROM playback_session
       WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3) ORDER BY started_at, session_id`, [accountId]);
    const excess = rows.length - max;
    const victims = rows.filter((r) => r.device_id !== ownDeviceId).slice(0, Math.max(0, excess));
    if (victims.length === 0) return [];
    await conn.query(`UPDATE playback_session SET status = 'PREEMPTED', ended_at = NOW(3) WHERE session_id IN (?) AND status = 'PLAYING'`, [victims.map((v) => v.session_id)]);
    const stateVersion = await bumpVersion(conn, accountId);
    for (const v of victims) {
      await writeEvent(conn, { accountId, deviceId: v.device_id, sessionId: Number(v.session_id), type: 'PREEMPTED', stateVersion, detail: { by: 'redis-reconcile', byDeviceId: ownDeviceId } });
    }
    return victims.map((v) => Number(v.session_id));
  });
}

export const redisLease: Strategy = {
  name: 'REDIS_LEASE',
  defaultIsolation: 'READ COMMITTED',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  async claim(conn, input, stats) {
    const acct = await readAccount(conn, input.accountId);
    const leaseMs = input.leaseMs ?? config.LEASE_MS;
    const { slot, stolenDevice } = await acquireSlot(input.accountId, acct.maxStreams, input.deviceId, leaseMs, input.mode === 'TAKEOVER');
    if (slot < 0) {
      return withTx(conn, 'READ COMMITTED', async () => reject(conn, input, (await readAccount(conn, input.accountId)).stateVersion));
    }
    try {
      const granted = await withRetry(() => withTx(conn, input.isolation ?? 'READ COMMITTED', async (): Promise<ClaimResult> => {
        let toPreempt: number[] = [];
        if (stolenDevice !== null && stolenDevice !== input.deviceId) {
          const [rows] = await conn.query<import('mysql2/promise').RowDataPacket[]>(
            `SELECT session_id FROM playback_session WHERE account_id = ? AND device_id = ? AND status = 'PLAYING'`, [input.accountId, stolenDevice]);
          toPreempt = rows.map((r) => Number(r.session_id));
        }
        await raceDelay(input);
        return grant(conn, input, { strategy: 'REDIS_LEASE', toPreempt });
      }), stats);
      if (input.mode === 'TAKEOVER' && granted.outcome === 'GRANTED') {
        const extra = await withRetry(() => reconcile(conn, input.accountId, input.deviceId, acct.maxStreams), stats);
        return { ...granted, preempted: [...granted.preempted, ...extra] };
      }
      return granted;
    } catch (err) {
      await freeSlots(input.accountId, [input.deviceId]);   // do not leak the slot until its TTL
      throw err;
    }
  },
};
