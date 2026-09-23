// Statements shared by the claim strategies. Each strategy file decides WHICH of these it runs,
// in what order, under which isolation level and with which locks; that choice is the lesson.
//
// Global lock order for every correct code path: account → device → playback_session → playback_event.

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { sleep } from '../db/tx.js';
import { bumpVersion } from '../services/accountState.js';
import { FaultInjectedError, type ClaimInput, type ClaimResult, type Holder, type StrategyName } from './types.js';

/** "Active" always means PLAYING with an unexpired lease, judged by the DB clock. */
export const ACTIVE = `status = 'PLAYING' AND lease_expires_at > NOW(3)`;

export interface AccountRow { maxStreams: number; stateVersion: number }

/**
 * Reads the account row. `lock` turns it into a locking read:
 *  - 'FOR UPDATE' makes the account row a per-account mutex (PESSIMISTIC).
 *  - '' is a plain read: a non-locking MVCC snapshot read, except under SERIALIZABLE where
 *    InnoDB silently turns it into a shared (S) lock.
 */
export async function readAccount(conn: PoolConnection, accountId: number, lock: '' | 'FOR UPDATE' = ''): Promise<AccountRow> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT max_streams, state_version FROM account WHERE account_id = ? ${lock}`,
    [accountId],
  );
  const r = rows[0];
  if (!r) throw new Error(`account ${accountId} not found`);
  return { maxStreams: r.max_streams, stateVersion: Number(r.state_version) };
}

/**
 * Counts active sessions held by OTHER devices of the account. The claiming device's own
 * session never blocks it: on grant it is ended and replaced (switching songs, resuming).
 * Uses ix_session_account_status_lease.
 */
export async function countActive(conn: PoolConnection, accountId: number, excludeDeviceId: number): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM playback_session
     WHERE account_id = ? AND ${ACTIVE} AND device_id <> ?`,
    [accountId, excludeDeviceId],
  );
  return Number(rows[0]!.n);
}

/** The `n` oldest active sessions of other devices: the ones a TAKEOVER preempts. */
export async function oldestActive(conn: PoolConnection, accountId: number, excludeDeviceId: number, n: number): Promise<number[]> {
  if (n <= 0) return [];
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT session_id FROM playback_session
     WHERE account_id = ? AND ${ACTIVE} AND device_id <> ?
     ORDER BY started_at, session_id LIMIT ?`,
    [accountId, excludeDeviceId, n],
  );
  return rows.map((r) => Number(r.session_id));
}

/** Who holds the stream slots, for the "Playing on MacBook" message. */
export async function listHolders(conn: PoolConnection, accountId: number, excludeDeviceId: number): Promise<Holder[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT s.session_id, s.device_id, d.device_name
     FROM playback_session s JOIN device d ON d.device_id = s.device_id
     WHERE s.account_id = ? AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3) AND s.device_id <> ?
     ORDER BY s.started_at, s.session_id`,
    [accountId, excludeDeviceId],
  );
  return rows.map((r) => ({ sessionId: Number(r.session_id), deviceId: r.device_id, deviceName: r.device_name }));
}

export const raceDelay = (input: ClaimInput) => (input.raceDelayMs ? sleep(input.raceDelayMs) : Promise.resolve());

type EventType =
  | 'CLAIM_GRANTED' | 'CLAIM_REJECTED' | 'PREEMPTED' | 'PAUSED' | 'RELEASED' | 'EXPIRED' | 'HEARTBEAT_REJECTED';

export interface EventInput {
  accountId: number; deviceId: number; sessionId: number | null; type: EventType;
  stateVersion: number; clientRequestId?: string | null; detail?: unknown;
}

export async function writeEvent(conn: PoolConnection, e: EventInput): Promise<void> {
  await conn.query(
    `INSERT INTO playback_event (account_id, device_id, session_id, event_type, state_version, client_request_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [e.accountId, e.deviceId, e.sessionId, e.type, e.stateVersion, e.clientRequestId ?? null,
      e.detail === undefined ? null : JSON.stringify(e.detail)],
  );
}

/** Records a rejection (no state change, so no version bump) and returns the REJECTED result. */
export async function reject(conn: PoolConnection, input: ClaimInput, stateVersion: number): Promise<ClaimResult> {
  const holders = await listHolders(conn, input.accountId, input.deviceId);
  await writeEvent(conn, {
    accountId: input.accountId, deviceId: input.deviceId, sessionId: null, type: 'CLAIM_REJECTED',
    stateVersion, clientRequestId: input.clientRequestId, detail: { holders, songId: input.songId },
  });
  return { outcome: 'REJECTED', stateVersion, holders };
}

export interface GrantOptions {
  strategy: StrategyName;
  toPreempt: number[];
  /** OPTIMISTIC already bumped the version in its CAS; everyone else bumps here. */
  stateVersion?: number;
}

/**
 * The write phase of a granted claim, in global lock order (sessions, then account, then events):
 *   1. preempt the chosen sessions (TAKEOVER),
 *   2. end this device's previous PLAYING/PAUSED session,
 *   3. INSERT the new session with a fresh lease,
 *   4. [fault injection point],
 *   5. bump account.state_version (after the INSERT; see bumpVersion),
 *   6. write the audit events.
 * Whether this is safe depends entirely on what the caller did BEFORE calling it.
 */
export async function grant(conn: PoolConnection, input: ClaimInput, opts: GrantOptions): Promise<ClaimResult> {
  const preempted = await preempt(conn, opts.toPreempt);
  await endDeviceSessions(conn, input.accountId, input.deviceId);
  const sessionId = await insertSession(conn, input, opts.strategy);
  if (input.fault === 'AFTER_SESSION_INSERT') throw new FaultInjectedError();
  const stateVersion = opts.stateVersion ?? (await bumpVersion(conn, input.accountId));

  await writeEvent(conn, {
    accountId: input.accountId, deviceId: input.deviceId, sessionId, type: 'CLAIM_GRANTED',
    stateVersion, clientRequestId: input.clientRequestId, detail: { preempted, songId: input.songId, mode: input.mode },
  });
  for (const p of preempted) {
    await writeEvent(conn, {
      accountId: input.accountId, deviceId: p.deviceId, sessionId: p.sessionId, type: 'PREEMPTED',
      stateVersion, detail: { byDeviceId: input.deviceId, bySessionId: sessionId },
    });
  }
  return { outcome: 'GRANTED', sessionId, stateVersion, preempted: preempted.map((p) => p.sessionId) };
}

async function preempt(conn: PoolConnection, sessionIds: number[]): Promise<{ sessionId: number; deviceId: number }[]> {
  if (sessionIds.length === 0) return [];
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT session_id, device_id FROM playback_session WHERE session_id IN (?) AND status = 'PLAYING'`,
    [sessionIds],
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.session_id));
  await conn.query(
    `UPDATE playback_session SET status = 'PREEMPTED', ended_at = NOW(3)
     WHERE session_id IN (?) AND status = 'PLAYING'`,
    [ids],
  );
  return rows.map((r) => ({ sessionId: Number(r.session_id), deviceId: r.device_id }));
}

/**
 * A device plays one thing at a time: its previous PLAYING/PAUSED session ends when it claims again.
 * Find the rows with a plain read, then UPDATE by primary key. A searched
 * `UPDATE … WHERE device_id = ?` would, at REPEATABLE READ, take next-key/gap locks on the FK
 * index even when nothing matches, and neighbouring devices' INSERTs would deadlock on those
 * gaps: an artefact of this helper, not of the strategy being measured.
 */
export async function endDeviceSessions(conn: PoolConnection, accountId: number, deviceId: number): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT session_id FROM playback_session
     WHERE device_id = ? AND account_id = ? AND status IN ('PLAYING', 'PAUSED')`,
    [deviceId, accountId],
  );
  if (rows.length === 0) return;
  await conn.query(
    `UPDATE playback_session SET status = 'ENDED', ended_at = NOW(3)
     WHERE session_id IN (?) AND status IN ('PLAYING', 'PAUSED')`,
    [rows.map((r) => r.session_id)],
  );
}

export async function insertSession(conn: PoolConnection, input: ClaimInput, strategy: StrategyName): Promise<number> {
  const [res] = await conn.query<ResultSetHeader>(
    `INSERT INTO playback_session (account_id, device_id, song_id, status, position_ms, lease_expires_at, strategy)
     VALUES (?, ?, ?, 'PLAYING', ?, NOW(3) + INTERVAL (? * 1000) MICROSECOND, ?)`,
    [input.accountId, input.deviceId, input.songId, input.positionMs ?? 0, config.LEASE_MS, strategy],
  );
  return res.insertId;
}
