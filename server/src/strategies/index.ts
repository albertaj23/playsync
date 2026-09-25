import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { isDupEntry } from '../db/errors.js';
import type { Stats } from '../db/tx.js';
import { constraint } from './constraint.js';
import { naive } from './naive.js';
import { optimistic } from './optimistic.js';
import { pessimistic } from './pessimistic.js';
import { serializable } from './serializable.js';
import { redisLease } from './redisLease.js';
import { trigger } from './trigger.js';
import { txnRr } from './txnRr.js';
import type { ClaimInput, ClaimResult, Strategy, StrategyName } from './types.js';

export const strategies: Record<StrategyName, Strategy> = {
  NAIVE: naive,
  TXN_RR: txnRr,
  SERIALIZABLE: serializable,
  PESSIMISTIC: pessimistic,
  OPTIMISTIC: optimistic,
  CONSTRAINT: constraint,
  TRIGGER: trigger,
  REDIS_LEASE: redisLease,
};

/** The original outcome of an earlier claim with the same (device, clientRequestId), if any. */
async function priorOutcome(conn: PoolConnection, deviceId: number, clientRequestId: string): Promise<ClaimResult | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT event_type, session_id, state_version, detail FROM playback_event
     WHERE device_id = ? AND client_request_id = ?`,
    [deviceId, clientRequestId],
  );
  const e = rows[0];
  if (!e) return null;
  const detail = (e.detail ?? {}) as { preempted?: { sessionId: number }[]; holders?: [] };
  return e.event_type === 'CLAIM_GRANTED'
    ? { outcome: 'GRANTED', sessionId: Number(e.session_id), stateVersion: Number(e.state_version),
        preempted: (detail.preempted ?? []).map((p) => p.sessionId) }
    : { outcome: 'REJECTED', stateVersion: Number(e.state_version), holders: detail.holders ?? [] };
}

/**
 * Runs a claim with idempotency on top of any strategy.
 * 1. A request id we've already answered returns the original outcome (double-click, client retry).
 * 2. Two concurrent requests with the same id: the second one's event INSERT hits
 *    uq_event_request (1062) after the first commits, its whole transaction rolls back
 *    (session included), and it returns the first one's outcome.
 *    NAIVE has no transaction, so there its duplicate session row survives: naive indeed.
 */
export async function executeClaim(strategy: Strategy, conn: PoolConnection, input: ClaimInput, stats: Stats): Promise<ClaimResult> {
  const id = input.clientRequestId;
  if (id) {
    const prior = await priorOutcome(conn, input.deviceId, id);
    if (prior) return prior;
  }
  try {
    return await strategy.claim(conn, input, stats);
  } catch (err) {
    if (id && isDupEntry(err) && String((err as Error).message).includes('uq_event_request')) {
      const prior = await priorOutcome(conn, input.deviceId, id);
      if (prior) return prior;
    }
    throw err;
  }
}

export type { ClaimInput, ClaimMode, ClaimResult, Strategy, StrategyName } from './types.js';
export { STRATEGY_NAMES } from './types.js';
