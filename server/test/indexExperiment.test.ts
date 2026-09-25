import { afterAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool, closePools } from '../src/db/pool.js';
import { runIndexExperiment } from '../src/lab/indexExperiment.js';
import { count } from './helpers.js';

afterAll(async () => { await closePools(); });

const indexes = async () => {
  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT DISTINCT index_name AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'playback_session'`);
  return rows.map((r) => r.n as string);
};

describe('index experiment', () => {
  it('the composite index shrinks the lock footprint and stops accounts blocking each other', async () => {
    const r = await runIndexExperiment();
    const [withIdx, without, bare] = r.variants;
    expect(withIdx!.explain.key).toBe('ix_session_account_status_lease');
    expect(withIdx!.otherAccountBlocked).toBe(false);
    expect(without!.locksHeld).toBeGreaterThan(withIdx!.locksHeld * 50);
    expect(without!.otherAccountBlocked).toBe(true);
    expect(bare!.explain.type).toBe('ALL');
    expect(r.historyRows).toBeGreaterThan(20000);
  }, 60_000);

  it('always restores both indexes and removes its rows', async () => {
    expect(await indexes()).toEqual(expect.arrayContaining(['ix_session_account_status_lease', 'ix_session_status_lease']));
    expect(await count(`SELECT COUNT(*) FROM playback_session WHERE strategy IN ('IDXHIST','IDXLAB')`)).toBe(0);
  });
});
