import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { appPool, closePools, labPool } from '../src/db/pool.js';
import { newStats } from '../src/db/tx.js';
import { checkInvariant } from '../src/lab/invariant.js';
import { setUniqueIndex } from '../src/strategies/constraint.js';
import { executeClaim, strategies, STRATEGY_NAMES, type ClaimInput, type ClaimResult, type Strategy } from '../src/strategies/index.js';
import { FaultInjectedError } from '../src/strategies/types.js';
import { count, deviceIds, firstSongId, resetAccount, sessionRow, stateVersion } from './helpers.js';

const LAB = 'lab_01';
let acct: number;
let devices: number[];
let song: number;

beforeAll(async () => {
  devices = await deviceIds(LAB);
  song = await firstSongId();
});

afterAll(async () => {
  const conn = await appPool.getConnection();
  await setUniqueIndex(conn, false).finally(() => conn.release());
  await resetAccount(LAB);
  await closePools();
});

async function claimOnce(s: Strategy, deviceIdx: number, extra: Partial<ClaimInput> = {}): Promise<ClaimResult> {
  const conn = await appPool.getConnection();
  try {
    return await executeClaim(s, conn, { accountId: acct, deviceId: devices[deviceIdx]!, songId: song, mode: 'NORMAL', ...extra }, newStats());
  } finally {
    conn.release();
  }
}

/** Fires n claims from n different devices at the same instant (pre-acquired connections + barrier). */
async function race(s: Strategy, n: number, extra: Partial<ClaimInput> = {}) {
  const conns: PoolConnection[] = await Promise.all(Array.from({ length: n }, () => labPool.getConnection()));
  let open!: () => void;
  const barrier = new Promise<void>((r) => { open = r; });
  const stats = newStats();
  const runs = conns.map(async (conn, i) => {
    await barrier;
    try {
      return await executeClaim(s, conn, { accountId: acct, deviceId: devices[i]!, songId: song, mode: 'NORMAL', ...extra }, stats);
    } finally {
      conn.release();
    }
  });
  open();
  const settled = await Promise.allSettled(runs);
  const results = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  return {
    granted: results.filter((r) => r.outcome === 'GRANTED').length,
    errors: settled.filter((r) => r.status === 'rejected').length,
    stats,
    violations: (await checkInvariant(appPool, [acct])).violations,
  };
}

const SAFE = ['SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT'] as const;
const UNSAFE = ['NAIVE', 'TXN_RR'] as const;

describe.each(STRATEGY_NAMES.map((n) => [n, strategies[n]] as const))('%s', (_name, s) => {
  beforeAll(async () => {
    const conn = await appPool.getConnection();
    await setUniqueIndex(conn, s.needsUniqueIndex).finally(() => conn.release());
  });
  beforeEach(async () => { acct = await resetAccount(LAB, 1); });

  it('grants the first claim and rejects a second device, naming the holder', async () => {
    const a = await claimOnce(s, 0);
    expect(a.outcome).toBe('GRANTED');
    const b = await claimOnce(s, 1);
    expect(b).toMatchObject({ outcome: 'REJECTED', holders: [{ deviceId: devices[0] }] });
    expect(await stateVersion(acct)).toBe(1);   // rejection is not a state change
    expect(await count(`SELECT COUNT(*) FROM playback_event WHERE account_id = ? AND event_type = 'CLAIM_REJECTED'`, [acct])).toBe(1);
  });

  it('TAKEOVER preempts the current holder', async () => {
    const a = await claimOnce(s, 0);
    const b = await claimOnce(s, 1, { mode: 'TAKEOVER' });
    if (a.outcome !== 'GRANTED' || b.outcome !== 'GRANTED') throw new Error('expected grants');
    expect(b.preempted).toEqual([a.sessionId]);
    expect((await sessionRow(a.sessionId))!.status).toBe('PREEMPTED');
    expect(b.stateVersion).toBe(2);
    expect(await count(`SELECT COUNT(*) FROM playback_event WHERE session_id = ? AND event_type = 'PREEMPTED'`, [a.sessionId])).toBe(1);
  });

  it("a device's own session doesn't block it: re-claiming replaces it", async () => {
    const a = await claimOnce(s, 0);
    const b = await claimOnce(s, 0, { positionMs: 42_000 });
    if (a.outcome !== 'GRANTED' || b.outcome !== 'GRANTED') throw new Error('expected grants');
    expect((await sessionRow(a.sessionId))!.status).toBe('ENDED');
    expect((await sessionRow(b.sessionId))!.position_ms).toBe(42_000);
  });

  it.runIf(s.supportsMaxStreamsAbove1)('respects max_streams = 2', async () => {
    acct = await resetAccount(LAB, 2);
    expect((await claimOnce(s, 0)).outcome).toBe('GRANTED');
    expect((await claimOnce(s, 1)).outcome).toBe('GRANTED');
    expect((await claimOnce(s, 2)).outcome).toBe('REJECTED');
  });

  it('is idempotent for a repeated clientRequestId', async () => {
    const id = randomUUID();
    const a = await claimOnce(s, 0, { clientRequestId: id });
    const b = await claimOnce(s, 0, { clientRequestId: id });
    expect(b).toEqual(a);
    expect(await count('SELECT COUNT(*) FROM playback_session WHERE account_id = ?', [acct])).toBe(1);
  });

  it.runIf(s.name !== 'NAIVE')('is idempotent for concurrent duplicates of one request', async () => {
    const id = randomUUID();
    const [a, b] = await Promise.all([claimOnce(s, 0, { clientRequestId: id }), claimOnce(s, 0, { clientRequestId: id })]);
    expect(a.outcome).toBe('GRANTED');
    expect(b).toEqual(a);
    expect(await count(`SELECT COUNT(*) FROM playback_session WHERE account_id = ? AND status = 'PLAYING'`, [acct])).toBe(1);
    expect(await count(`SELECT COUNT(*) FROM playback_event WHERE account_id = ? AND event_type = 'CLAIM_GRANTED'`, [acct])).toBe(1);
  });

  if (s.name === 'NAIVE') {
    it('fault after INSERT leaves the session behind (no atomicity without a transaction)', async () => {
      await expect(claimOnce(s, 0, { fault: 'AFTER_SESSION_INSERT' })).rejects.toBeInstanceOf(FaultInjectedError);
      expect(await count('SELECT COUNT(*) FROM playback_session WHERE account_id = ?', [acct])).toBe(1);
      expect(await count('SELECT COUNT(*) FROM playback_event WHERE account_id = ?', [acct])).toBe(0);
    });
  } else {
    it('fault after INSERT rolls everything back (atomicity)', async () => {
      await expect(claimOnce(s, 0, { fault: 'AFTER_SESSION_INSERT' })).rejects.toBeInstanceOf(FaultInjectedError);
      expect(await count('SELECT COUNT(*) FROM playback_session WHERE account_id = ?', [acct])).toBe(0);
      expect(await count('SELECT COUNT(*) FROM playback_event WHERE account_id = ?', [acct])).toBe(0);
      expect(await stateVersion(acct)).toBe(0);
    });
  }
});

// Small concurrency smoke test. The full race runner and the 20-trial × 50-way tests are Phase 4.
describe('concurrent claims on one account (20 devices, 20 ms race window)', () => {
  beforeEach(async () => { acct = await resetAccount(LAB, 1); });

  it.each(SAFE)('%s never violates the invariant', async (name) => {
    const conn = await appPool.getConnection();
    await setUniqueIndex(conn, strategies[name].needsUniqueIndex).finally(() => conn.release());
    for (let trial = 0; trial < 3; trial++) {
      acct = await resetAccount(LAB, 1);
      const r = await race(strategies[name], 20, { raceDelayMs: 20 });
      expect(r.violations).toBe(0);
      expect(r.granted).toBeLessThanOrEqual(1);
    }
  });

  it.each(SAFE)('%s keeps the invariant in TAKEOVER mode', async (name) => {
    const conn = await appPool.getConnection();
    await setUniqueIndex(conn, strategies[name].needsUniqueIndex).finally(() => conn.release());
    const r = await race(strategies[name], 20, { raceDelayMs: 20, mode: 'TAKEOVER' });
    expect(r.violations).toBe(0);
    expect(r.granted).toBeGreaterThanOrEqual(1);
  });

  it.each(UNSAFE)('%s violates the invariant in at least one of 5 trials', async (name) => {
    const conn = await appPool.getConnection();
    await setUniqueIndex(conn, false).finally(() => conn.release());
    let violations = 0;
    for (let trial = 0; trial < 5 && violations === 0; trial++) {
      acct = await resetAccount(LAB, 1);
      violations += (await race(strategies[name], 20, { raceDelayMs: 20 })).violations;
    }
    expect(violations).toBeGreaterThan(0);
  });
});
