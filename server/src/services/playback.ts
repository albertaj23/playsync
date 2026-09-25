import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { appPool } from '../db/pool.js';
import { newStats, withTx } from '../db/tx.js';
import { writeEvent } from '../strategies/common.js';
import { prepareForStrategy } from '../strategies/artifacts.js';
import { executeClaim, strategies, type ClaimResult, type StrategyName } from '../strategies/index.js';
import type { ClaimMode, Holder } from '../strategies/types.js';
import { extendSlot, freeAllSlots, freeSlots } from '../db/redis.js';
import { isOnline } from '../realtime/presence.js';
import { publish } from '../realtime/publisher.js';
import { bumpVersion, readSnapshot, type Snapshot } from './accountState.js';

// Every function below that changes state finishes its transaction BEFORE calling publish():
// clients are only ever told about committed state.

export type ConflictPolicy = 'REJECT' | 'TAKEOVER' | 'ASK';
export type LostReason = 'PREEMPTED' | 'EXPIRED' | 'ENDED' | 'PAUSED' | 'NOT_FOUND';

/** A command about a session the device no longer owns. Maps to HTTP 410; the client must stop. */
export class SessionLostError extends Error {
  constructor(readonly reason: LostReason, readonly byDeviceName?: string) {
    super(`session lost: ${reason}`);
    this.name = 'SessionLostError';
  }
}

/** A request that is well-formed but not allowed in the current state. Maps to HTTP 400/404/409. */
export class ServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: object = {}) {
    super(message);
    this.name = 'ServiceError';
  }
}

async function withConn<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await appPool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------------------ live strategy

let liveStrategy: StrategyName = config.DEFAULT_STRATEGY;
export const getLiveStrategy = () => liveStrategy;

/**
 * Switches the strategy the live app uses. CONSTRAINT needs the unique index and only works
 * with max_streams = 1; every other strategy needs the index GONE, or it would be silently protected.
 */
export async function setLiveStrategy(name: StrategyName): Promise<void> {
  const strategy = strategies[name];
  await withConn(async (conn) => {
    if (!strategy.supportsMaxStreamsAbove1) {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT username FROM account WHERE is_lab = FALSE AND max_streams > 1',
      );
      if (rows.length > 0) {
        throw new ServiceError(409, 'MAX_STREAMS_UNSUPPORTED',
          `${name} only supports max_streams = 1; lower it first for: ${rows.map((r) => r.username).join(', ')}`);
      }
    }
    await prepareForStrategy(conn, name);
  });
  liveStrategy = name;
  publish().strategyChanged();
}

// ------------------------------------------------------------------ snapshot & settings

export function getSnapshot(accountId: number): Promise<Snapshot | null> {
  return withConn((conn) => readSnapshot(conn, accountId, liveStrategy, isOnline));
}

export async function updateSettings(accountId: number, maxStreams: number, conflictPolicy: ConflictPolicy) {
  if (maxStreams > 1 && !strategies[liveStrategy].supportsMaxStreamsAbove1) {
    throw new ServiceError(400, 'MAX_STREAMS_UNSUPPORTED', `${liveStrategy} only supports max_streams = 1`);
  }
  const result = await withConn((conn) => withTx(conn, 'READ COMMITTED', async () => {
    const [acct] = await conn.query<RowDataPacket[]>(
      'SELECT account_id FROM account WHERE account_id = ? FOR UPDATE', [accountId]);
    if (acct.length === 0) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
    // Lowering the limit below the current active count would break the invariant immediately.
    const [cnt] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM playback_session
       WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3)`, [accountId]);
    const active = Number(cnt[0]!.n);
    if (active > maxStreams) {
      throw new ServiceError(409, 'ACTIVE_EXCEEDS_LIMIT',
        `${active} streams are playing; stop some before lowering the limit to ${maxStreams}`, { active });
    }
    await conn.query('UPDATE account SET max_streams = ?, conflict_policy = ? WHERE account_id = ?',
      [maxStreams, conflictPolicy, accountId]);
    return { accountId, maxStreams, conflictPolicy, stateVersion: await bumpVersion(conn, accountId) };
  }));
  publish().accountChanged(accountId);
  return result;
}

export async function deviceHello(deviceId: number) {
  return withConn(async (conn) => {
    await conn.query('UPDATE device SET last_seen_at = NOW(3) WHERE device_id = ?', [deviceId]);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT d.device_id, d.device_name, d.device_type, a.account_id, a.username
       FROM device d JOIN account a ON a.account_id = d.account_id WHERE d.device_id = ?`, [deviceId]);
    const d = rows[0];
    if (!d) throw new ServiceError(404, 'NOT_FOUND', 'device not found');
    return { deviceId: d.device_id, deviceName: d.device_name, deviceType: d.device_type,
      accountId: d.account_id, username: d.username };
  });
}

// ------------------------------------------------------------------ claim

export interface ClaimRequest {
  deviceId: number; songId: number; mode: ClaimMode; clientRequestId?: string; positionMs?: number;
}

export type ClaimResponse =
  | (Extract<ClaimResult, { outcome: 'GRANTED' }> & { accountId: number; strategy: StrategyName })
  | { outcome: 'REJECTED'; code: 'LIMIT_REACHED'; accountId: number; stateVersion: number;
      holders: Holder[]; policy: ConflictPolicy; canTakeOver: boolean };

/**
 * Applies the account's conflict policy, then runs the live strategy.
 *  REJECT   → never take over (a TAKEOVER request is downgraded to NORMAL).
 *  TAKEOVER → always claim in TAKEOVER mode (preempts only if the limit is reached).
 *  ASK      → claim as asked; a NORMAL conflict comes back with canTakeOver so the client can
 *             confirm and resend with mode TAKEOVER and a new clientRequestId.
 * The policy is read outside the claim transaction: it steers UX, it doesn't protect the invariant.
 */
export async function claim(req: ClaimRequest): Promise<ClaimResponse> {
  return withConn(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT a.account_id, a.conflict_policy, a.max_streams, d.device_name FROM device d
       JOIN account a ON a.account_id = d.account_id WHERE d.device_id = ?`, [req.deviceId]);
    const acct = rows[0];
    if (!acct) throw new ServiceError(404, 'NOT_FOUND', 'device not found');
    const policy = acct.conflict_policy as ConflictPolicy;
    const strategyName = liveStrategy;
    const strategy = strategies[strategyName];
    if (acct.max_streams > 1 && !strategy.supportsMaxStreamsAbove1) {
      throw new ServiceError(400, 'MAX_STREAMS_UNSUPPORTED', `${strategyName} only supports max_streams = 1`);
    }
    const mode: ClaimMode = policy === 'TAKEOVER' ? 'TAKEOVER' : policy === 'REJECT' ? 'NORMAL' : req.mode;

    const result = await executeClaim(strategy, conn, {
      accountId: acct.account_id, deviceId: req.deviceId, songId: req.songId, mode,
      clientRequestId: req.clientRequestId, positionMs: req.positionMs,
    }, newStats());

    // executeClaim has committed by now. A rejection changed nothing, so there is nothing to push.
    if (result.outcome === 'GRANTED') {
      publish().accountChanged(acct.account_id);
      if (result.preempted.length > 0) {
        const [victims] = await conn.query<RowDataPacket[]>(
          'SELECT session_id, device_id FROM playback_session WHERE session_id IN (?)', [result.preempted]);
        for (const v of victims) {
          publish().sessionLost(v.device_id, { sessionId: Number(v.session_id), reason: 'PREEMPTED', byDeviceName: acct.device_name });
        }
      }
      return { ...result, accountId: acct.account_id, strategy: strategyName };
    }
    return { outcome: 'REJECTED', code: 'LIMIT_REACHED', accountId: acct.account_id,
      stateVersion: result.stateVersion, holders: result.holders, policy, canTakeOver: policy === 'ASK' };
  });
}

// ------------------------------------------------------------------ heartbeat (fencing)

/** Why a session is no longer ours. Plain read; used only after a fenced write matched 0 rows. */
async function lostReason(conn: PoolConnection, sessionId: number, deviceId: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT s.account_id, s.status, s.lease_expires_at <= NOW(3) AS lapsed, a.state_version
     FROM playback_session s JOIN account a ON a.account_id = s.account_id
     WHERE s.session_id = ? AND s.device_id = ?`, [sessionId, deviceId]);
  const r = rows[0];
  if (!r) return { reason: 'NOT_FOUND' as const, accountId: null, stateVersion: 0, byDeviceName: undefined };
  const reason: LostReason = r.status === 'PLAYING' ? 'EXPIRED' : r.status;
  
  let byDeviceName: string | undefined;
  if (reason === 'PREEMPTED') {
    const [events] = await conn.query<RowDataPacket[]>(
      `SELECT d.device_name 
       FROM playback_event e JOIN device d ON e.detail->>'$.byDeviceId' = d.device_id
       WHERE e.session_id = ? AND e.event_type = 'PREEMPTED'`, [sessionId]);
    if (events[0]) {
      byDeviceName = events[0].device_name;
    }
  }

  return { reason, accountId: r.account_id as number, stateVersion: Number(r.state_version), byDeviceName };
}

/**
 * Extends the lease. The WHERE clause is the fence: only a PLAYING session whose lease is still
 * valid can be extended, so an expired lease is never revived and a preempted session never
 * comes back (the "zombie laptop waking from sleep" case). No version bump: a heartbeat does
 * not change the active set.
 */
export async function heartbeat(sessionId: number, deviceId: number, positionMs: number, leaseMs: number = config.LEASE_MS) {
  return withConn(async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE playback_session
       SET lease_expires_at = NOW(3) + INTERVAL (? * 1000) MICROSECOND, position_ms = ?
       WHERE session_id = ? AND device_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3)`,
      [leaseMs, positionMs, sessionId, deviceId]);
    if (res.affectedRows === 1) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT account_id, TIMESTAMPDIFF(MICROSECOND, NOW(3), lease_expires_at) DIV 1000 AS ms
         FROM playback_session WHERE session_id = ?`, [sessionId]);
      await extendSlot(rows[0]!.account_id, deviceId, leaseMs);   // REDIS_LEASE only; no-op otherwise
      // No version bump, but watchers' lease countdowns and positions are refreshed.
      publish().accountChanged(rows[0]!.account_id);
      return { leaseRemainingMs: Number(rows[0]!.ms) };
    }
    const lost = await lostReason(conn, sessionId, deviceId);
    if (lost.accountId !== null) {
      await writeEvent(conn, { accountId: lost.accountId, deviceId, sessionId, type: 'HEARTBEAT_REJECTED',
        stateVersion: lost.stateVersion, detail: { reason: lost.reason, positionMs } });
      publish().accountChanged(lost.accountId);   // so the audit log shows the rejection
    }
    throw new SessionLostError(lost.reason, lost.byDeviceName);
  });
}

// ------------------------------------------------------------------ pause & release

/**
 * Shared shape of pause/release: lock the account (global lock order), fenced UPDATE of the
 * session, bump the version, write the event. READ COMMITTED so the fenced UPDATE judges the
 * latest committed row.
 */
async function endOrPause(sessionId: number, deviceId: number, kind: 'PAUSED' | 'RELEASED', positionMs?: number) {
  return withConn(async (conn) => {
    const [owner] = await conn.query<RowDataPacket[]>(
      'SELECT account_id FROM playback_session WHERE session_id = ? AND device_id = ?', [sessionId, deviceId]);
    if (!owner[0]) throw new SessionLostError('NOT_FOUND');
    const accountId = owner[0].account_id as number;

    const result = await withTx(conn, 'READ COMMITTED', async () => {
      await conn.query('SELECT account_id FROM account WHERE account_id = ? FOR UPDATE', [accountId]);
      const [res] = kind === 'PAUSED'
        ? await conn.query<ResultSetHeader>(
          `UPDATE playback_session SET status = 'PAUSED', position_ms = COALESCE(?, position_ms)
           WHERE session_id = ? AND device_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3)`,
          [positionMs ?? null, sessionId, deviceId])
        : await conn.query<ResultSetHeader>(
          `UPDATE playback_session SET status = 'ENDED', ended_at = NOW(3), position_ms = COALESCE(?, position_ms)
           WHERE session_id = ? AND device_id = ?
             AND (status = 'PAUSED' OR (status = 'PLAYING' AND lease_expires_at > NOW(3)))`,
          [positionMs ?? null, sessionId, deviceId]);
      if (res.affectedRows === 0) {
        const lost = await lostReason(conn, sessionId, deviceId);
        throw new SessionLostError(lost.reason, lost.byDeviceName);
      }
      const stateVersion = await bumpVersion(conn, accountId);
      await writeEvent(conn, { accountId, deviceId, sessionId, type: kind, stateVersion,
        detail: positionMs === undefined ? undefined : { positionMs } });
      return { accountId, sessionId, stateVersion };
    });
    await freeSlots(accountId, [deviceId]);   // REDIS_LEASE only; no-op otherwise
    publish().accountChanged(accountId);
    return result;
  });
}

export const pause = (sessionId: number, deviceId: number, positionMs?: number) =>
  endOrPause(sessionId, deviceId, 'PAUSED', positionMs);
export const release = (sessionId: number, deviceId: number, positionMs?: number) =>
  endOrPause(sessionId, deviceId, 'RELEASED', positionMs);

/**
 * Demo helper: ends every PLAYING/PAUSED session of the account (history is kept).
 * Same shape as release: account lock first, then sessions, version bump, events.
 */
export async function endAll(accountId: number) {
  const ended: { sessionId: number; deviceId: number }[] = [];
  const result = await withConn((conn) => withTx(conn, 'READ COMMITTED', async () => {
    const [acct] = await conn.query<RowDataPacket[]>(
      'SELECT account_id FROM account WHERE account_id = ? FOR UPDATE', [accountId]);
    if (acct.length === 0) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT session_id, device_id FROM playback_session
       WHERE account_id = ? AND status IN ('PLAYING', 'PAUSED')`, [accountId]);
    if (rows.length === 0) return { ended: 0 };
    await conn.query(
      `UPDATE playback_session SET status = 'ENDED', ended_at = NOW(3) WHERE session_id IN (?)`,
      [rows.map((r) => r.session_id)]);
    const stateVersion = await bumpVersion(conn, accountId);
    for (const r of rows) {
      await writeEvent(conn, { accountId, deviceId: r.device_id, sessionId: Number(r.session_id),
        type: 'RELEASED', stateVersion, detail: { by: 'end-all' } });
      ended.push({ sessionId: Number(r.session_id), deviceId: r.device_id });
    }
    return { ended: rows.length, stateVersion };
  }));
  await freeAllSlots(accountId);
  if (result.ended > 0) {
    publish().accountChanged(accountId);
    for (const e of ended) publish().sessionLost(e.deviceId, { sessionId: e.sessionId, reason: 'ENDED' });
  }
  return result;
}
