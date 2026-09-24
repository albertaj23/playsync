import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { appPool, closePools } from '../src/db/pool.js';
import { newStats } from '../src/db/tx.js';
import { runChecks } from '../src/services/checks.js';
import { heartbeat, setLiveStrategy } from '../src/services/playback.js';
import { executeClaim, strategies } from '../src/strategies/index.js';
import { deviceIds, expireLease, firstSongId, resetAccount } from './helpers.js';

const app = createApp();
let acct: number, devices: number[], song: number;

beforeEach(async () => {
  acct = await resetAccount('brij', 1, 'ASK');
  devices = await deviceIds('brij');
  song = await firstSongId();
  await setLiveStrategy('PESSIMISTIC');
});
afterAll(async () => {
  await resetAccount('brij', 1, 'ASK');
  await closePools();
});

const failing = async () => (await runChecks(acct)).filter((c) => !c.passed).map((c) => c.id);
const claimVia = async (name: keyof typeof strategies, deviceIdx: number, extra = {}) => {
  const conn = await appPool.getConnection();
  try {
    return await executeClaim(strategies[name], conn,
      { accountId: acct, deviceId: devices[deviceIdx]!, songId: song, mode: 'NORMAL', ...extra }, newStats());
  } finally { conn.release(); }
};

describe('GET /accounts/:id/checks', () => {
  it('all pass after normal use (play, take over, fenced zombie heartbeat)', async () => {
    const a = await request(app).post('/api/playback/claim').send({ deviceId: devices[0], songId: song });
    await request(app).post('/api/playback/claim').send({ deviceId: devices[1], songId: song, mode: 'TAKEOVER' });
    await expect(heartbeat(a.body.sessionId, devices[0]!, 1000)).rejects.toMatchObject({ reason: 'PREEMPTED' });
    const r = await request(app).get(`/api/accounts/${acct}/checks`);
    expect(r.status).toBe(200);
    expect(r.body.allPassed).toBe(true);
    expect(r.body.checks).toHaveLength(6);
    expect(r.body.checks.find((c: { id: string }) => c.id === 'fencing').detail).toContain('1 late heartbeat');
  });

  it('flags a broken stream limit', async () => {
    await claimVia('NAIVE', 0);
    await appPool.query(
      `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy)
       VALUES (?, ?, ?, 'PLAYING', NOW(3) + INTERVAL 15 SECOND, 'TEST')`, [acct, devices[1], song]);
    expect(await failing()).toContain('invariant');
  });

  it('flags a lapsed lease the reaper has not cleaned up', async () => {
    const r = await claimVia('PESSIMISTIC', 0);
    if (r.outcome !== 'GRANTED') throw new Error('expected grant');
    await expireLease(r.sessionId);
    await appPool.query('UPDATE playback_session SET lease_expires_at = NOW(3) - INTERVAL 1 MINUTE WHERE session_id = ?', [r.sessionId]);
    expect(await failing()).toEqual(['reaper']);
  });

  it('flags a session with no audit record (NAIVE + fault: no atomicity)', async () => {
    await expect(claimVia('NAIVE', 0, { fault: 'AFTER_SESSION_INSERT' })).rejects.toThrow();
    expect(await failing()).toContain('atomicity');
  });

  it('flags a device with two open sessions', async () => {
    await claimVia('PESSIMISTIC', 0);
    await appPool.query(
      `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy)
       VALUES (?, ?, ?, 'PAUSED', NOW(3), 'TEST')`, [acct, devices[0], song]);
    expect(await failing()).toContain('one-per-device');
  });
});
