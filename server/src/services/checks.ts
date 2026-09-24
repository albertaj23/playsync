// Live correctness checks for one account, run against the database on demand.
// The friendly UI lets anyone click around; the "Stats for nerds" page calls this after every
// action so the consequences are verified by SQL, not just displayed.

import type { RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { appPool } from '../db/pool.js';

export interface Check {
  id: string;
  title: string;
  /** What passing proves, in plain language. */
  meaning: string;
  passed: boolean;
  detail: string;
}

async function one(sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  const [rows] = await appPool.query<RowDataPacket[]>(sql, params);
  return rows[0] ?? {};
}

export async function runChecks(accountId: number): Promise<Check[]> {
  // A lapsed lease should be reaped within about one reaper interval; allow two plus slack.
  const graceMs = config.REAPER_MS * 2 + 1000;

  const inv = await one(
    `SELECT a.max_streams,
            (SELECT COUNT(*) FROM playback_session s
             WHERE s.account_id = a.account_id AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3)) AS active
     FROM account a WHERE a.account_id = ?`, [accountId]);

  const stale = await one(
    `SELECT COUNT(*) AS n FROM playback_session
     WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at <= NOW(3) - INTERVAL (? * 1000) MICROSECOND`,
    [accountId, graceMs]);

  const perDevice = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT device_id FROM playback_session
       WHERE account_id = ? AND status IN ('PLAYING', 'PAUSED')
       GROUP BY device_id HAVING COUNT(*) > 1) x`, [accountId]);

  const orphans = await one(
    `SELECT COUNT(*) AS n FROM playback_session s
     WHERE s.account_id = ?
       AND NOT EXISTS (SELECT 1 FROM playback_event e WHERE e.session_id = s.session_id AND e.event_type = 'CLAIM_GRANTED')`,
    [accountId]);

  const versions = await one(
    `SELECT a.state_version AS account_v, COALESCE(MAX(e.state_version), 0) AS max_event_v
     FROM account a LEFT JOIN playback_event e ON e.account_id = a.account_id
     WHERE a.account_id = ? GROUP BY a.state_version`, [accountId]);

  const fenced = await one(
    `SELECT COUNT(*) AS rejected,
            COUNT(DISTINCT IF(s.status = 'PLAYING' AND s.lease_expires_at > NOW(3), s.session_id, NULL)) AS revived
     FROM playback_event e JOIN playback_session s ON s.session_id = e.session_id
     WHERE e.account_id = ? AND e.event_type = 'HEARTBEAT_REJECTED'`, [accountId]);

  const active = Number(inv.active ?? 0);
  const max = Number(inv.max_streams ?? 0);
  const accountV = Number(versions.account_v ?? 0);
  const maxEventV = Number(versions.max_event_v ?? 0);

  return [
    {
      id: 'invariant',
      title: 'Stream limit respected',
      meaning: 'No more devices are playing than the account allows.',
      passed: active <= max,
      detail: `${active} playing, limit ${max}`,
    },
    {
      id: 'reaper',
      title: 'Dead devices cleaned up',
      meaning: 'A device that stopped checking in is marked expired within a few seconds.',
      passed: Number(stale.n) === 0,
      detail: `${stale.n} lapsed session(s) older than ${graceMs} ms still marked PLAYING`,
    },
    {
      id: 'one-per-device',
      title: 'One session per device',
      meaning: 'Each device plays one thing at a time; starting a new song replaces the old one.',
      passed: Number(perDevice.n) === 0,
      detail: `${perDevice.n} device(s) with more than one open session`,
    },
    {
      id: 'atomicity',
      title: 'Every session was recorded',
      meaning: 'Starting playback and logging it happen together or not at all.',
      passed: Number(orphans.n) === 0,
      detail: `${orphans.n} session(s) without a CLAIM_GRANTED audit event`,
    },
    {
      id: 'versions',
      title: 'Version counter never behind',
      meaning: 'Screens can trust the version number to order updates.',
      passed: accountV >= maxEventV,
      detail: `account.state_version = ${accountV}, highest logged = ${maxEventV}`,
    },
    {
      id: 'fencing',
      title: 'Stopped devices stay stopped',
      meaning: 'A device that was taken over or timed out cannot sneak back in.',
      passed: Number(fenced.revived ?? 0) === 0,
      detail: `${fenced.rejected ?? 0} late heartbeat(s) refused, ${fenced.revived ?? 0} session(s) revived`,
    },
  ];
}
