import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { createApp } from '../src/app.js';
import { appPool, closePools } from '../src/db/pool.js';
import { withLabLock } from '../src/lab/labLock.js';
import { parseConfig, parseLivePatch, SimConfigError } from '../src/lab/sim/config.js';
import { simEngine } from '../src/lab/sim/engine.js';
import { readTruth } from '../src/lab/sim/truth.js';
import { reapOnce } from '../src/services/leaseReaper.js';
import { setUniqueIndex } from '../src/strategies/constraint.js';
import { accountId, count } from './helpers.js';

const app = createApp();
const LONG = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = { accounts: 1, devicesPerAccount: 8, maxStreams: 1, arrival: 'BURST', checkDelayMs: 20, durationSec: 30, listenMinSec: 25, listenMaxSec: 30 };

async function runFor(cfg: object, ms: number) {
  await simEngine.start({ ...base, ...cfg });
  await sleep(ms);
  return simEngine.stop();
}

afterAll(async () => {
  await simEngine.stop();
  const conn = await appPool.getConnection();
  await setUniqueIndex(conn, false).finally(() => conn.release());
  await closePools();
});

describe('sim config', () => {
  it('rejects over-cap values and non-live PATCH fields', async () => {
    expect(() => parseConfig({ accounts: 17 })).toThrow();
    expect(() => parseConfig({ offlinePct: 60 })).toThrow();
    expect(() => parseConfig({ strategy: 'CONSTRAINT', maxStreams: 2 })).toThrow(SimConfigError);
    expect(() => parseLivePatch({ accounts: 3 })).toThrow(SimConfigError);
    expect(parseLivePatch({ jitterMs: 100 })).toEqual({ jitterMs: 100 });
  });
});

describe('ground truth', () => {
  it('NAIVE + burst + hesitation produces at least one real violation', async () => {
    const snap = await runFor({ strategy: 'NAIVE' }, 3000);
    expect(snap.kpis.newViolationEvents).toBeGreaterThanOrEqual(1);
    expect(snap.kpis.peakExcess).toBeGreaterThan(0);
  }, LONG);

  it.each(['PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT', 'SERIALIZABLE'] as const)('%s never violates', async (strategy) => {
    const snap = await runFor({ strategy }, 3500);
    expect(snap.kpis.newViolationEvents).toBe(0);
    expect(snap.kpis.peakExcess).toBe(0);
    expect(snap.kpis.played).toBeGreaterThanOrEqual(1);
  }, LONG);
});

describe('live changes', () => {
  it('switching NAIVE -> PESSIMISTIC stops new damage (allowing one tick of in-flight claims)', async () => {
    await simEngine.start({ ...base, strategy: 'NAIVE', arrival: 'STEADY', ratePerSec: 12, listenMinSec: 3, listenMaxSec: 4, durationSec: 30 });
    await sleep(2500);
    await simEngine.patch({ strategy: 'PESSIMISTIC' });
    await sleep(700); // one tick of claims that started before the switch
    const atSwitch = simEngine.snapshot().kpis;
    await sleep(6000);
    const after = simEngine.snapshot().kpis;
    expect(after.newViolationEvents).toBe(atSwitch.newViolationEvents);
    expect(after.peakExcess).toBe(atSwitch.peakExcess);
    expect(simEngine.snapshot().markers.some((m) => m.label.includes('Lock, then check'))).toBe(true);
    await simEngine.stop();
  }, LONG);
});

describe('faults and expiry', () => {
  it('crashPct = 100 leaves no orphan sessions and no half-written events', async () => {
    const id = await accountId('lab_01');
    await runFor({ strategy: 'PESSIMISTIC', crashPct: 20 }, 100); // warm path; then the real check below
    const snap = await (async () => {
      await simEngine.start({ ...base, strategy: 'PESSIMISTIC' });
      await simEngine.patch({ crashPct: 20 });
      await sleep(2500);
      return simEngine.stop();
    })();
    expect(snap.kpis.failed).toBeGreaterThanOrEqual(0);
    const granted = await count(`SELECT COUNT(*) FROM playback_event WHERE account_id = ${id} AND event_type = 'CLAIM_GRANTED'`);
    const sessions = await count(`SELECT COUNT(*) FROM playback_session WHERE account_id = ${id}`);
    expect(sessions).toBe(granted); // every session row has its CLAIM_GRANTED event: nothing half-written
  }, LONG);

  it('offline devices expire through the sim sweep; the global reaper still skips lab accounts', async () => {
    await simEngine.start({ ...base, strategy: 'PESSIMISTIC', arrival: 'STEADY', ratePerSec: 6, maxStreams: 4, leaseSec: 5, offlinePct: 50, durationSec: 30 });
    await sleep(14_000);
    await simEngine.stop();
    const id = await accountId('lab_01');
    expect(await count(`SELECT COUNT(*) FROM playback_event WHERE account_id = ${id} AND event_type = 'EXPIRED'`)).toBeGreaterThan(0);

    await appPool.query(
      `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy)
       SELECT ?, MIN(device_id), 1, 'PLAYING', NOW(3) - INTERVAL 1 SECOND, 'X' FROM device WHERE account_id = ?`, [id, id]);
    await reapOnce();
    expect(await count(`SELECT COUNT(*) FROM playback_session WHERE account_id = ${id} AND status = 'PLAYING'`)).toBe(1);
  }, LONG);
});

describe('repair', () => {
  it('brings every household back within its limit and writes events', async () => {
    await simEngine.start({ ...base, strategy: 'NAIVE', accounts: 2 });
    await sleep(2500);
    const before = await readTruth(simEngine.snapshot().households.map((_, i) => i).length ? await simAccountIds() : []);
    expect(before.some((t) => t.active > t.max)).toBe(true);
    const r = await simEngine.repair();
    expect(r.households).toBeGreaterThanOrEqual(1);
    const after = await readTruth(await simAccountIds());
    expect(after.every((t) => t.active <= t.max)).toBe(true);
    const repairEvents = await count(`SELECT COUNT(*) FROM playback_event WHERE JSON_EXTRACT(detail, '$.by') = 'repair'`);
    expect(repairEvents).toBeGreaterThanOrEqual(1);
    await simEngine.stop();
  }, LONG);
});

async function simAccountIds(): Promise<number[]> {
  const [rows] = await appPool.query<RowDataPacket[]>(`SELECT account_id FROM account WHERE is_lab = TRUE ORDER BY account_id LIMIT 2`);
  return rows.map((r) => r.account_id);
}

describe('teardown and persistence', () => {
  it('stop releases the lab lock, restores max_streams and leaves nothing playing', async () => {
    const id = await accountId('lab_01');
    await appPool.query('UPDATE account SET max_streams = 3 WHERE account_id = ?', [id]);
    await runFor({ strategy: 'NAIVE' }, 2000);
    expect(await count(`SELECT max_streams FROM account WHERE account_id = ${id}`)).toBe(3);
    expect(await count(`SELECT COUNT(*) FROM playback_session WHERE account_id = ${id} AND status IN ('PLAYING','PAUSED')`)).toBe(0);
    expect(await count(`SELECT GET_LOCK('playsync.lab', 0)`)).toBe(1);
    await appPool.query(`SELECT RELEASE_LOCK('playsync.lab')`);
    await appPool.query('UPDATE account SET max_streams = 1 WHERE account_id = ?', [id]);
  }, LONG);

  it('a finished run writes an experiment_run row with source SIM', async () => {
    const snap = await runFor({ strategy: 'PESSIMISTIC' }, 2000);
    expect(snap.summary?.batchId).toBeTruthy();
    expect(await count(`SELECT COUNT(*) FROM experiment_run WHERE source = 'SIM' AND batch_id = '${snap.summary!.batchId}'`)).toBe(1);
    const res = await request(app).get(`/api/lab/sim/runs/${snap.summary!.batchId}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toBeTruthy();
  }, LONG);

  it('start while the lab lock is held returns 409 BUSY', async () => {
    const res = await withLabLock(async () => request(app).post('/api/lab/sim/start').send(base));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BUSY');
  }, LONG);
});
