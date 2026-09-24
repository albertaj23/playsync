import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { closePools } from '../src/db/pool.js';
import { setLiveStrategy } from '../src/services/playback.js';
import { count, deviceIds, expireLease, firstSongId, resetAccount, sessionRow } from './helpers.js';

const app = createApp();
let acct: number;
let mac: number, iphone: number, ipad: number;
let song: number;

const claim = (deviceId: number, body: object = {}) =>
  request(app).post('/api/playback/claim').send({ deviceId, songId: song, ...body });
const heartbeat = (sessionId: number, deviceId: number, positionMs = 1000) =>
  request(app).post('/api/playback/heartbeat').send({ sessionId, deviceId, positionMs });
const state = () => request(app).get(`/api/accounts/${acct}/state`);

beforeAll(async () => {
  [mac, iphone, ipad] = (await deviceIds('brij')) as [number, number, number];
  song = await firstSongId();
  await setLiveStrategy('PESSIMISTIC');
});
beforeEach(async () => { acct = await resetAccount('brij', 1, 'ASK'); });
afterAll(async () => {
  await resetAccount('brij', 1, 'ASK');
  await setLiveStrategy(config.DEFAULT_STRATEGY);
  await closePools();
});

describe('conflict policies', () => {
  it('ASK: 409 with holders and canTakeOver, then TAKEOVER preempts', async () => {
    const a = await claim(mac);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ outcome: 'GRANTED', accountId: acct, strategy: 'PESSIMISTIC', stateVersion: 1 });

    const b = await claim(iphone);
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({
      code: 'LIMIT_REACHED', policy: 'ASK', canTakeOver: true,
      holders: [{ deviceId: mac, deviceName: 'MacBook', sessionId: a.body.sessionId }],
    });

    const c = await claim(iphone, { mode: 'TAKEOVER', clientRequestId: randomUUID() });
    expect(c.status).toBe(200);
    expect(c.body.preempted).toEqual([a.body.sessionId]);
  });

  it('REJECT: a TAKEOVER request is refused', async () => {
    acct = await resetAccount('brij', 1, 'REJECT');
    await claim(mac);
    const b = await claim(iphone, { mode: 'TAKEOVER' });
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ policy: 'REJECT', canTakeOver: false });
  });

  it('TAKEOVER: a NORMAL request takes over automatically', async () => {
    acct = await resetAccount('brij', 1, 'TAKEOVER');
    const a = await claim(mac);
    const b = await claim(iphone);
    expect(b.status).toBe(200);
    expect(b.body.preempted).toEqual([a.body.sessionId]);
  });
});

describe('heartbeats and fencing', () => {
  it('extends the lease and reports the DB-computed remaining time', async () => {
    const a = await claim(mac);
    const hb = await heartbeat(a.body.sessionId, mac, 5000);
    expect(hb.status).toBe(200);
    expect(hb.body.leaseRemainingMs).toBeGreaterThan(config.LEASE_MS - 1000);
    expect(hb.body.leaseRemainingMs).toBeLessThanOrEqual(config.LEASE_MS);
    expect((await sessionRow(a.body.sessionId))!.position_ms).toBe(5000);
  });

  it('410 PREEMPTED for a zombie device whose session was taken over', async () => {
    const a = await claim(mac);
    await claim(iphone, { mode: 'TAKEOVER' });
    const hb = await heartbeat(a.body.sessionId, mac);
    expect(hb.status).toBe(410);
    expect(hb.body).toEqual({ code: 'SESSION_LOST', reason: 'PREEMPTED', byDeviceName: 'iPhone' });
    expect(await count(
      `SELECT COUNT(*) FROM playback_event WHERE session_id = ? AND event_type = 'HEARTBEAT_REJECTED'`,
      [a.body.sessionId])).toBe(1);
  });

  it('410 EXPIRED after the lease lapses, and the lease is NOT revived', async () => {
    const a = await claim(mac);
    await expireLease(a.body.sessionId);
    const hb = await heartbeat(a.body.sessionId, mac);
    expect(hb.status).toBe(410);
    expect(hb.body.reason).toBe('EXPIRED');
    expect(hb.body.byDeviceName).toBeUndefined();
    expect((await sessionRow(a.body.sessionId))!.live).toBe(0);
    // The slot is free for another device even before the reaper runs.
    expect((await claim(iphone)).status).toBe(200);
  });

  it("rejects a heartbeat for another device's session", async () => {
    const a = await claim(mac);
    const hb = await heartbeat(a.body.sessionId, iphone);
    expect(hb.status).toBe(410);
    expect(hb.body.reason).toBe('NOT_FOUND');
  });
});

describe('pause, resume and release', () => {
  it('pausing frees the slot; resuming goes through claim again', async () => {
    const a = await claim(mac);
    const p = await request(app).post('/api/playback/pause').send({ sessionId: a.body.sessionId, deviceId: mac, positionMs: 30_000 });
    expect(p.status).toBe(200);
    expect(p.body.stateVersion).toBe(2);
    expect((await heartbeat(a.body.sessionId, mac)).body.reason).toBe('PAUSED');

    // Paused holds no slot, so the iPhone can play …
    const b = await claim(iphone);
    expect(b.status).toBe(200);
    // … and the MacBook's resume is now a conflict like any other claim.
    expect((await claim(mac, { positionMs: 30_000 })).status).toBe(409);

    const snap = await state();
    expect(snap.body.sessions.map((s: { status: string }) => s.status)).toEqual(['PAUSED', 'PLAYING']);
  });

  it('resuming on the same device replaces the paused session at its position', async () => {
    const a = await claim(mac);
    await request(app).post('/api/playback/pause').send({ sessionId: a.body.sessionId, deviceId: mac, positionMs: 30_000 });
    const r = await claim(mac, { positionMs: 30_000 });
    expect(r.status).toBe(200);
    expect((await sessionRow(a.body.sessionId))!.status).toBe('ENDED');
    expect((await sessionRow(r.body.sessionId))!.position_ms).toBe(30_000);
  });

  it('release ends the session; releasing again is 410', async () => {
    const a = await claim(mac);
    const rel = () => request(app).post('/api/playback/release').send({ sessionId: a.body.sessionId, deviceId: mac });
    expect((await rel()).status).toBe(200);
    expect((await sessionRow(a.body.sessionId))!.status).toBe('ENDED');
    const again = await rel();
    expect(again.status).toBe(410);
    expect(again.body.reason).toBe('ENDED');
  });
});

describe('idempotency', () => {
  it('the same clientRequestId twice yields one session', async () => {
    const id = randomUUID();
    const a = await claim(mac, { clientRequestId: id });
    const b = await claim(mac, { clientRequestId: id });
    expect(b.body.sessionId).toBe(a.body.sessionId);
    expect(await count('SELECT COUNT(*) FROM playback_session WHERE account_id = ?', [acct])).toBe(1);
  });

  it('a replayed rejection stays a rejection', async () => {
    await claim(mac);
    const id = randomUUID();
    expect((await claim(iphone, { clientRequestId: id })).status).toBe(409);
    expect((await claim(iphone, { clientRequestId: id })).status).toBe(409);
  });
});

describe('account state and settings', () => {
  it('snapshot lists devices, active sessions and a DB-computed lease', async () => {
    await claim(mac);
    const snap = await state();
    expect(snap.status).toBe(200);
    expect(snap.body).toMatchObject({ accountId: acct, stateVersion: 1, maxStreams: 1, conflictPolicy: 'ASK', strategy: 'PESSIMISTIC' });
    expect(snap.body.devices).toHaveLength(4);
    expect(snap.body.sessions).toHaveLength(1);
    expect(snap.body.sessions[0]).toMatchObject({ deviceName: 'MacBook', status: 'PLAYING' });
    expect(snap.body.sessions[0].leaseRemainingMs).toBeGreaterThan(0);
  });

  it('refuses to lower max_streams below the active count', async () => {
    const put = (maxStreams: number) =>
      request(app).put(`/api/accounts/${acct}/settings`).send({ maxStreams, conflictPolicy: 'ASK' });
    expect((await put(2)).status).toBe(200);
    expect((await claim(mac)).status).toBe(200);
    expect((await claim(iphone)).status).toBe(200);
    expect((await claim(ipad)).status).toBe(409);
    const lower = await put(1);
    expect(lower.status).toBe(409);
    expect(lower.body).toMatchObject({ code: 'ACTIVE_EXCEEDS_LIMIT', active: 2 });
  });

  it('validates input', async () => {
    expect((await request(app).post('/api/playback/claim').send({ deviceId: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/playback/claim').send({ deviceId: 999999, songId: song })).status).toBe(404);
    expect((await request(app).put(`/api/accounts/${acct}/settings`).send({ maxStreams: 11, conflictPolicy: 'ASK' })).status).toBe(400);
    expect((await request(app).get('/api/accounts/999999/state')).status).toBe(404);
  });

  it('POST /devices/:id/hello records last_seen_at (online comes from sockets, not hello)', async () => {
    const r = await request(app).post(`/api/devices/${mac}/hello`);
    expect(r.body).toMatchObject({ deviceName: 'MacBook', username: 'brij' });
    expect(await count('SELECT last_seen_at > NOW(3) - INTERVAL 5 SECOND FROM device WHERE device_id = ?', [mac])).toBe(1);
    expect((await state()).body.devices[0].online).toBe(false);
  });
});

describe('switching the live strategy', () => {
  const indexCount = () => count(
    `SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
     AND table_name = 'playback_session' AND index_name = 'uq_one_active_per_account'`);

  it('CONSTRAINT adds the unique index; switching away drops it', async () => {
    const put = (strategy: string) => request(app).put('/api/admin/strategy').send({ strategy });
    expect((await put('CONSTRAINT')).status).toBe(200);
    expect(await indexCount()).toBe(1);
    expect((await claim(mac)).body.strategy).toBe('CONSTRAINT');
    expect((await claim(iphone)).status).toBe(409);
    expect((await put('PESSIMISTIC')).status).toBe(200);
    expect(await indexCount()).toBe(0);
  });

  it('CONSTRAINT is refused while an account allows more than one stream', async () => {
    acct = await resetAccount('brij', 2, 'ASK');
    const r = await request(app).put('/api/admin/strategy').send({ strategy: 'CONSTRAINT' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MAX_STREAMS_UNSUPPORTED');
    expect((await request(app).get('/api/admin/strategy')).body.strategy).toBe('PESSIMISTIC');
  });
});
