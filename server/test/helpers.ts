import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from '../src/db/pool.js';
import type { ConflictPolicy } from '../src/services/playback.js';

export async function accountId(username: string): Promise<number> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT account_id FROM account WHERE username = ?', [username]);
  return rows[0]!.account_id;
}

/** Device ids of an account, in device_id order. */
export async function deviceIds(username: string): Promise<number[]> {
  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT d.device_id FROM device d JOIN account a USING (account_id) WHERE a.username = ? ORDER BY d.device_id`,
    [username]);
  return rows.map((r) => r.device_id);
}

export async function firstSongId(): Promise<number> {
  const [rows] = await appPool.query<RowDataPacket[]>('SELECT MIN(song_id) AS id FROM song');
  return rows[0]!.id;
}

/** Wipes an account's sessions and events and resets its settings. */
export async function resetAccount(username: string, maxStreams = 1, policy: ConflictPolicy = 'REJECT') {
  const id = await accountId(username);
  await appPool.query('DELETE FROM playback_event WHERE account_id = ?', [id]);
  await appPool.query('DELETE FROM playback_session WHERE account_id = ?', [id]);
  await appPool.query(
    'UPDATE account SET max_streams = ?, conflict_policy = ?, state_version = 0 WHERE account_id = ?',
    [maxStreams, policy, id]);
  return id;
}

export async function sessionRow(sessionId: number) {
  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT status, lease_expires_at > NOW(3) AS live, position_ms FROM playback_session WHERE session_id = ?`,
    [sessionId]);
  return rows[0] as { status: string; live: number; position_ms: number } | undefined;
}

export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await appPool.query<RowDataPacket[]>(sql, params);
  return Number(Object.values(rows[0]!)[0]);
}

export async function stateVersion(id: number): Promise<number> {
  return count('SELECT state_version FROM account WHERE account_id = ?', [id]);
}

/** Makes a session's lease lapse without waiting LEASE_MS. */
export async function expireLease(sessionId: number) {
  await appPool.query(
    'UPDATE playback_session SET lease_expires_at = NOW(3) - INTERVAL 1 SECOND WHERE session_id = ?', [sessionId]);
}
