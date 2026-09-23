import { afterAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool, closePools } from '../src/db/pool.js';
import { ER_NO_REFERENCED_ROW_2, errnoOf } from '../src/db/errors.js';

afterAll(closePools);

async function scalar<T = number>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await appPool.query<RowDataPacket[]>(sql, params);
  return Object.values(rows[0]!)[0] as T;
}

describe('seed data', () => {
  it('has the expected row counts', async () => {
    expect(await scalar('SELECT COUNT(*) FROM account')).toBe(19);
    expect(await scalar('SELECT COUNT(*) FROM account WHERE is_lab')).toBe(16);
    expect(await scalar('SELECT COUNT(*) FROM device')).toBe(4 + 16 * 64 + 2 * 2);
    expect(await scalar('SELECT COUNT(*) FROM song')).toBe(12);
  });

  it('gives every lab account exactly 64 devices', async () => {
    const [rows] = await appPool.query<RowDataPacket[]>(
      `SELECT a.username, COUNT(d.device_id) AS n
       FROM account a LEFT JOIN device d ON d.account_id = a.account_id
       WHERE a.is_lab GROUP BY a.account_id, a.username`,
    );
    expect(rows).toHaveLength(16);
    for (const r of rows) expect(r.n).toBe(64);
  });

  it('seeds the demo account and its four devices', async () => {
    const [rows] = await appPool.query<RowDataPacket[]>(
      `SELECT d.device_name, d.device_type FROM device d
       JOIN account a ON a.account_id = d.account_id
       WHERE a.username = 'brij' ORDER BY d.device_id`,
    );
    expect(rows.map((r) => [r.device_name, r.device_type])).toEqual([
      ['MacBook', 'DESKTOP'], ['iPhone', 'MOBILE'], ['iPad', 'TABLET'], ['Browser', 'WEB'],
    ]);
  });

  it('keeps song durations within 2..4 minutes', async () => {
    expect(await scalar('SELECT COUNT(*) FROM song WHERE duration_ms NOT BETWEEN 120000 AND 240000')).toBe(0);
  });

  it('does not create the CONSTRAINT-strategy unique index permanently', async () => {
    expect(await scalar(
      `SELECT COUNT(*) FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'playback_session'
         AND index_name = 'uq_one_active_per_account'`,
    )).toBe(0);
  });
});

describe('integrity constraints', () => {
  it('rejects a session whose device belongs to a different account (composite FK)', async () => {
    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      // Device of `brij`, but account_id of `step_a`.
      const insert = conn.query(
        `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy)
         SELECT (SELECT account_id FROM account WHERE username = 'step_a'),
                (SELECT d.device_id FROM device d JOIN account a USING (account_id)
                  WHERE a.username = 'brij' AND d.device_name = 'MacBook'),
                (SELECT MIN(song_id) FROM song),
                'PLAYING', NOW(3) + INTERVAL 15 SECOND, 'TEST'`,
      );
      const err = await insert.then(() => null, (e: unknown) => e);
      expect(errnoOf(err)).toBe(ER_NO_REFERENCED_ROW_2);
      expect((err as Error).message).toContain('fk_session_device_account');
    } finally {
      await conn.rollback();
      conn.release();
    }
  });

  it('accepts a session whose device matches its account', async () => {
    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy)
         SELECT d.account_id, d.device_id, (SELECT MIN(song_id) FROM song),
                'PLAYING', NOW(3) + INTERVAL 15 SECOND, 'TEST'
         FROM device d JOIN account a USING (account_id)
         WHERE a.username = 'brij' AND d.device_name = 'MacBook'`,
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT active_account_id, account_id FROM playback_session WHERE session_id = LAST_INSERT_ID()',
      );
      // Generated column mirrors account_id while PLAYING.
      expect(rows[0]!.active_account_id).toBe(rows[0]!.account_id);
    } finally {
      await conn.rollback();
      conn.release();
    }
  });

  it('blocks moving a device that has sessions to another account (update anomaly)', async () => {
    const conn = await appPool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy)
         SELECT d.account_id, d.device_id, (SELECT MIN(song_id) FROM song), 'ENDED', NOW(3), 'TEST'
         FROM device d JOIN account a USING (account_id)
         WHERE a.username = 'brij' AND d.device_name = 'MacBook'`,
      );
      const err = await conn
        .query(
          `UPDATE device d JOIN account a USING (account_id)
           SET d.account_id = (SELECT account_id FROM (SELECT account_id FROM account WHERE username = 'step_a') x)
           WHERE a.username = 'brij' AND d.device_name = 'MacBook'`,
        )
        .then(() => null, (e: unknown) => e);
      expect(errnoOf(err)).toBe(1451); // ER_ROW_IS_REFERENCED_2
    } finally {
      await conn.rollback();
      conn.release();
    }
  });

  it('enforces the max_streams CHECK constraint', async () => {
    const err = await appPool
      .query(`UPDATE account SET max_streams = 11 WHERE username = 'brij'`)
      .then(() => null, (e: unknown) => e);
    expect(errnoOf(err)).toBe(3819); // ER_CHECK_CONSTRAINT_VIOLATED
  });
});
