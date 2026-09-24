import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePools } from '../src/db/pool.js';
import { count, deviceIds, firstSongId, resetAccount } from './helpers.js';

const app = createApp();
afterAll(async () => {
  await resetAccount('brij', 1, 'ASK');
  await closePools();
});

describe('read-only endpoints for the UI', () => {
  it('GET /config, /songs, /strategies', async () => {
    expect((await request(app).get('/api/config')).body).toMatchObject({ leaseMs: expect.any(Number), heartbeatMs: expect.any(Number) });
    expect((await request(app).get('/api/songs')).body).toHaveLength(12);
    expect((await request(app).get('/api/strategies')).body).toHaveLength(6);
  });

  it('GET /accounts/lookup resolves a username', async () => {
    expect((await request(app).get('/api/accounts/lookup?username=brij')).body).toMatchObject({ username: 'brij' });
    expect((await request(app).get('/api/accounts/lookup?username=nobody')).status).toBe(404);
  });

  it('GET /db/overview lists tables, indexes and the composite FK', async () => {
    const { body } = await request(app).get('/api/db/overview');
    expect(body.tables.map((t: { name: string }) => t.name)).toContain('playback_session');
    const session = body.tables.find((t: { name: string }) => t.name === 'playback_session');
    expect(session.foreignKeys).toContainEqual(expect.objectContaining({ name: 'fk_session_device_account', columns: 'device_id,account_id' }));
    expect(body.accounts).toEqual({ demo: 1, lab: 16, stepper: 2 });
  });

  it('GET /accounts/:id/events and POST /accounts/:id/end-all', async () => {
    const acct = await resetAccount('brij', 1, 'ASK');
    const [mac] = await deviceIds('brij');
    await request(app).post('/api/playback/claim').send({ deviceId: mac, songId: await firstSongId() });
    const ended = await request(app).post(`/api/accounts/${acct}/end-all`);
    expect(ended.body.ended).toBe(1);
    const events = (await request(app).get(`/api/accounts/${acct}/events`)).body;
    expect(events.map((e: { type: string }) => e.type)).toEqual(['RELEASED', 'CLAIM_GRANTED']);
    expect(await count(`SELECT COUNT(*) FROM playback_session WHERE account_id = ? AND status = 'PLAYING'`, [acct])).toBe(0);
  });
});

describe('POST /lab/race (single-trial preview)', () => {
  const race = (body: object) => request(app).post('/api/lab/race').send({ concurrency: 20, raceDelayMs: 20, ...body });

  it('PESSIMISTIC: one grant, no violations', async () => {
    const r = await race({ strategy: 'PESSIMISTIC' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ granted: 1, rejected: 19, violations: 0, errors: 0 });
    expect(r.body.runId).toEqual(expect.any(Number));
    expect(r.body.batchId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('groups two calls under one batchId when the caller supplies it', async () => {
    const batchId = randomUUID();
    const a = await race({ strategy: 'PESSIMISTIC', batchId });
    const b = await race({ strategy: 'OPTIMISTIC', batchId });
    expect(a.body.batchId).toBe(batchId);
    expect(b.body.batchId).toBe(batchId);
    const runs = await request(app).get(`/api/lab/runs?batchId=${batchId}`);
    expect(runs.body).toHaveLength(2);
    expect(runs.body.map((r: { strategy: string }) => r.strategy).sort()).toEqual(['OPTIMISTIC', 'PESSIMISTIC']);
  });

  it('NAIVE: violations under contention', async () => {
    const r = await race({ strategy: 'NAIVE' });
    expect(r.body.violations).toBeGreaterThan(0);
  });

  it('spreads load over several accounts', async () => {
    const r = await race({ strategy: 'OPTIMISTIC', accounts: 4 });
    expect(r.body).toMatchObject({ granted: 4, violations: 0 });
  });

  it('rejects CONSTRAINT with max_streams > 1 and restores the index afterwards', async () => {
    expect((await race({ strategy: 'CONSTRAINT', maxStreams: 2 })).status).toBe(400);
    await race({ strategy: 'CONSTRAINT' });
    expect(await count(`SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
      AND table_name = 'playback_session' AND index_name = 'uq_one_active_per_account'`)).toBe(0);
  });
});
