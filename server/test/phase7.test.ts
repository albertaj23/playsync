import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool, closePools } from '../src/db/pool.js';
import { closeRedis, flushSlots, getRedis } from '../src/db/redis.js';
import { runStreamLimitExperiment } from '../src/lab/raceRunner.js';
import { prepareForStrategy } from '../src/strategies/artifacts.js';
import { executeClaim, strategies } from '../src/strategies/index.js';
import { newStats } from '../src/db/tx.js';
import { freeSlots } from '../src/db/redis.js';
import { deviceIds, firstSongId, resetAccount } from './helpers.js';

let redisUp = false;
beforeAll(async () => {
  try { await getRedis().ping(); redisUp = true; } catch { redisUp = false; }
});
afterAll(async () => {
  const conn = await appPool.getConnection();
  await prepareForStrategy(conn, 'PESSIMISTIC').finally(() => conn.release());
  if (redisUp) await flushSlots();
  await closeRedis();
  await closePools();
});

const triggerExists = async () => {
  const [r] = await appPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = 'trg_limit_active_sessions'`);
  return Number(r[0]!.n) > 0;
};

async function claim(name: 'TRIGGER' | 'REDIS_LEASE', accountId: number, deviceId: number, mode: 'NORMAL' | 'TAKEOVER' = 'NORMAL') {
  const conn = await appPool.getConnection();
  try {
    return await executeClaim(strategies[name], conn, { accountId, deviceId, songId: await firstSongId(), mode }, newStats());
  } finally { conn.release(); }
}

describe('TRIGGER strategy', () => {
  it('the trigger exists only while the strategy is prepared, and a sequential second claim is rejected by it', async () => {
    const conn = await appPool.getConnection();
    try {
      await prepareForStrategy(conn, 'TRIGGER');
      expect(await triggerExists()).toBe(true);
      const id = await resetAccount('lab_02');
      const [d1, d2] = await deviceIds('lab_02');
      expect((await claim('TRIGGER', id, d1!)).outcome).toBe('GRANTED');
      expect((await claim('TRIGGER', id, d2!)).outcome).toBe('REJECTED');
      await prepareForStrategy(conn, 'PESSIMISTIC');
      expect(await triggerExists()).toBe(false);
    } finally { conn.release(); }
  });

  it('is mostly safe under a race but is not guaranteed (at most a handful of excess sessions, never a crash)', async () => {
    const { trials } = await runStreamLimitExperiment(
      { strategy: 'TRIGGER', concurrency: 32, accounts: 1, maxStreams: 1, raceDelayMs: 20, mode: 'NORMAL', trials: 8, source: 'TEST' }, 'PESSIMISTIC');
    for (const t of trials) { expect(t.granted).toBeGreaterThanOrEqual(1); expect(t.violations).toBeLessThan(8); }
    expect(await triggerExists()).toBe(false);   // restored for the live strategy afterwards
  }, 120_000);
});

describe('REDIS_LEASE strategy', () => {
  it('never exceeds the limit: 15 trials x 50-way races at limit 1 and 3', async () => {
    if (!redisUp) return;
    for (const maxStreams of [1, 3]) {
      const { trials } = await runStreamLimitExperiment(
        { strategy: 'REDIS_LEASE', concurrency: 50, accounts: 1, maxStreams, raceDelayMs: 20, mode: 'NORMAL', trials: 15, source: 'TEST' }, 'PESSIMISTIC');
      for (const t of trials) { expect(t.violations).toBe(0); expect(t.granted).toBe(maxStreams); }
    }
  }, 120_000);

  it('TAKEOVER ends within the limit after reconciliation', async () => {
    if (!redisUp) return;
    const { trials } = await runStreamLimitExperiment(
      { strategy: 'REDIS_LEASE', concurrency: 50, accounts: 1, maxStreams: 2, raceDelayMs: 20, mode: 'TAKEOVER', trials: 5, source: 'TEST' }, 'PESSIMISTIC');
    for (const t of trials) expect(t.violations).toBe(0);
  }, 120_000);

  it('a freed slot can be taken again immediately, and a rejected claim leaves nothing behind', async () => {
    if (!redisUp) return;
    await flushSlots();
    const id = await resetAccount('lab_03');
    const [d1, d2] = await deviceIds('lab_03');
    expect((await claim('REDIS_LEASE', id, d1!)).outcome).toBe('GRANTED');
    expect((await claim('REDIS_LEASE', id, d2!)).outcome).toBe('REJECTED');
    await freeSlots(id, [d1!]);
    expect((await claim('REDIS_LEASE', id, d2!)).outcome).toBe('GRANTED');
  });
});
