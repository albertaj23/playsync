import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';

/**
 * Every committed state change bumps account.state_version (PLAN.md §2 item 11).
 * LAST_INSERT_ID(expr) stores the new value per connection, so we can read it back without a
 * second locking read. Must run AFTER any INSERT in the same transaction, because an
 * AUTO_INCREMENT insert overwrites LAST_INSERT_ID().
 */
export async function bumpVersion(conn: PoolConnection, accountId: number): Promise<number> {
  await conn.query(
    'UPDATE account SET state_version = LAST_INSERT_ID(state_version + 1) WHERE account_id = ?',
    [accountId],
  );
  const [rows] = await conn.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS v');
  return Number(rows[0]!.v);
}

export interface Snapshot {
  accountId: number;
  stateVersion: number;
  maxStreams: number;
  conflictPolicy: 'REJECT' | 'TAKEOVER' | 'ASK';
  strategy: string;
  devices: { deviceId: number; deviceName: string; deviceType: string; online: boolean }[];
  sessions: {
    sessionId: number; deviceId: number; deviceName: string; songId: number; songTitle: string;
    status: 'PLAYING' | 'PAUSED'; positionMs: number; leaseRemainingMs: number | null;
  }[];
}

/**
 * Reads the account's live state. The three SELECTs run in one READ ONLY transaction with a
 * consistent snapshot, so stateVersion always matches the sessions list it is sent with.
 * Returns null if the account does not exist.
 */
export async function readSnapshot(conn: PoolConnection, accountId: number, strategy: string): Promise<Snapshot | null> {
  await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const [acct] = await conn.query<RowDataPacket[]>(
      'SELECT account_id, state_version, max_streams, conflict_policy FROM account WHERE account_id = ?',
      [accountId],
    );
    if (acct.length === 0) return null;
    const [devices] = await conn.query<RowDataPacket[]>(
      // "online" = seen within one lease period. Phase 3 replaces this with live socket presence.
      `SELECT device_id, device_name, device_type,
              COALESCE(last_seen_at > NOW(3) - INTERVAL (? * 1000) MICROSECOND, FALSE) AS online
       FROM device WHERE account_id = ? ORDER BY device_id`,
      [config.LEASE_MS, accountId],
    );
    // Active = PLAYING with an unexpired lease; PAUSED sessions are shown but hold no stream slot.
    // leaseRemainingMs is computed by the DB clock so client clock skew never matters.
    const [sessions] = await conn.query<RowDataPacket[]>(
      `SELECT s.session_id, s.device_id, d.device_name, s.song_id, g.title, s.status, s.position_ms,
              IF(s.status = 'PLAYING', TIMESTAMPDIFF(MICROSECOND, NOW(3), s.lease_expires_at) DIV 1000, NULL)
                AS lease_remaining_ms
       FROM playback_session s
       JOIN device d ON d.device_id = s.device_id
       JOIN song g   ON g.song_id = s.song_id
       WHERE s.account_id = ?
         AND (s.status = 'PAUSED' OR (s.status = 'PLAYING' AND s.lease_expires_at > NOW(3)))
       ORDER BY s.started_at, s.session_id`,
      [accountId],
    );
    const a = acct[0]!;
    return {
      accountId: a.account_id,
      stateVersion: Number(a.state_version),
      maxStreams: a.max_streams,
      conflictPolicy: a.conflict_policy,
      strategy,
      devices: devices.map((d) => ({
        deviceId: d.device_id, deviceName: d.device_name, deviceType: d.device_type, online: Boolean(d.online),
      })),
      sessions: sessions.map((s) => ({
        sessionId: Number(s.session_id), deviceId: s.device_id, deviceName: s.device_name,
        songId: s.song_id, songTitle: s.title, status: s.status, positionMs: s.position_ms,
        leaseRemainingMs: s.lease_remaining_ms === null ? null : Number(s.lease_remaining_ms),
      })),
    };
  } finally {
    await conn.query('COMMIT');
  }
}
