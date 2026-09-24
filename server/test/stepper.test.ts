import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool, closePools } from '../src/db/pool.js';
import { checkInvariant } from '../src/lab/invariant.js';
import { engine } from '../src/lab/stepper/engine.js';
import { readLocks } from '../src/lab/stepper/locks.js';
import { SCENARIOS } from '../src/lab/stepper/scenarios.js';
import type { StepResultView, TxnLabel } from '../src/lab/stepper/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Steps through a scenario's own suggestedOrder end to end, waiting for async settles. */
async function run(id: string) {
  await engine.load(id);
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  for (const entry of scenario.suggestedOrder) {
    if (entry === 'KILL_T1') { await engine.kill('T1'); await sleep(30); continue; }
    await engine.step(entry as TxnLabel);
    await sleep(30);
  }
  await sleep(700); // let any WAITING step (deadlock detection, lock release) resolve
  return engine.view();
}

const errorStep = (steps: StepResultView[]) => steps.find((s) => s.status === 'ERROR');

afterAll(async () => {
  await engine.closeAll();
  await closePools();
});

describe('scenario 1: RACE_TXN_RR', () => {
  it('both transactions commit and the invariant is violated', async () => {
    const view = await run('RACE_TXN_RR');
    expect(view.txns.T1.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(view.txns.T2.steps.every((s) => s.status === 'DONE')).toBe(true);
    const { violations } = await checkInvariant(appPool, view.accountIds);
    expect(violations).toBeGreaterThan(0);
  });
});

describe('scenario 2: PESSIMISTIC_RC', () => {
  it("T2's FOR UPDATE waits for T1's lock, then correctly sees 1 and rejects", async () => {
    await engine.load('PESSIMISTIC_RC');
    await engine.step('T1'); // BEGIN
    await engine.step('T1'); // FOR UPDATE, succeeds (free)
    await engine.step('T2'); // BEGIN
    const t2Lock = await engine.step('T2'); // FOR UPDATE, should still be waiting on T1
    expect(t2Lock.status).toBe('WAITING');

    // The lock table should show T1 holding a record lock on account.
    const snapshot = await readLocks(appPool, (id) => engine.labelForConnId(id));
    const accountLocks = snapshot.locks.filter((l) => l.label === 'T1' && l.table === 'account');
    expect(accountLocks.some((l) => l.mode === 'X,REC_NOT_GAP')).toBe(true);
    // And a wait edge T2 -> T1.
    expect(snapshot.waits.some((w) => w.waitingLabel === 'T2' && w.blockingLabel === 'T1')).toBe(true);

    await engine.step('T1'); // count
    await engine.step('T1'); // insert
    await engine.step('T1'); // commit - releases the lock, T2 unblocks
    await sleep(300);
    const view = engine.view();
    expect(view.txns.T2.steps[1]!.status).toBe('DONE'); // the FOR UPDATE finally resolved

    const t2Count = await engine.step('T2'); // count, now sees T1's committed row
    expect(t2Count.rows).toEqual([{ active: 1 }]);
    await engine.step('T2'); // rollback

    const { violations } = await checkInvariant(appPool, view.accountIds);
    expect(violations).toBe(0);
  });
});

describe('scenario 3: PESSIMISTIC_RR_PITFALL', () => {
  it('locking after an initial read at REPEATABLE READ still violates the invariant', async () => {
    const view = await run('PESSIMISTIC_RR_PITFALL');
    expect(view.txns.T1.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(view.txns.T2.steps.every((s) => s.status === 'DONE')).toBe(true);
    const { violations } = await checkInvariant(appPool, view.accountIds);
    expect(violations).toBeGreaterThan(0);
  });
});

describe('scenario 4: SERIALIZABLE_DEADLOCK', () => {
  it('exactly one side gets errno 1213 with deadlock text; the survivor commits; no violation', async () => {
    const view = await run('SERIALIZABLE_DEADLOCK');
    const t1Error = errorStep(view.txns.T1.steps);
    const t2Error = errorStep(view.txns.T2.steps);
    // Exactly one side errored.
    expect([t1Error, t2Error].filter(Boolean)).toHaveLength(1);
    const victimError = t1Error ?? t2Error!;
    expect(victimError.errno).toBe(1213);
    expect(victimError.deadlockText).toBeTruthy();
    expect(victimError.deadlockText).toContain('LATEST DETECTED DEADLOCK');
    const { violations } = await checkInvariant(appPool, view.accountIds);
    expect(violations).toBe(0);
  });
});

describe('scenario 5: OPTIMISTIC_CAS', () => {
  it("T1's CAS matches and commits; T2's CAS affects 0 rows and it rolls back", async () => {
    const view = await run('OPTIMISTIC_CAS');
    const t1Cas = view.txns.T1.steps[2]!;
    const t2Cas = view.txns.T2.steps[2]!;
    expect(t1Cas.status).toBe('DONE');
    expect(t1Cas.affectedRows).toBe(1);
    expect(t2Cas.status).toBe('DONE'); // the UPDATE itself succeeds as a statement; it just matches nothing
    expect(t2Cas.affectedRows).toBe(0);
    const { violations } = await checkInvariant(appPool, view.accountIds);
    expect(violations).toBe(0);
  });
});

describe('scenario 6/6b: CLASSIC_DEADLOCK vs ORDERED_LOCKING', () => {
  it('CLASSIC_DEADLOCK: opposite lock order deadlocks (1213)', async () => {
    const view = await run('CLASSIC_DEADLOCK');
    const err = errorStep(view.txns.T1.steps) ?? errorStep(view.txns.T2.steps);
    expect(err?.errno).toBe(1213);
  });

  it('ORDERED_LOCKING: same lock order never deadlocks', async () => {
    const view = await run('ORDERED_LOCKING');
    expect(errorStep(view.txns.T1.steps)).toBeUndefined();
    expect(errorStep(view.txns.T2.steps)).toBeUndefined();
    expect(view.txns.T1.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(view.txns.T2.steps.every((s) => s.status === 'DONE')).toBe(true);
  });
});

describe('scenario 7: KILL_RECOVERY', () => {
  it('killing T1 removes its uncommitted row and its locks via the undo log; T2 proceeds', async () => {
    const view = await run('KILL_RECOVERY');
    expect(view.txns.T1.killed).toBe(true);
    expect(view.txns.T2.steps.every((s) => s.status === 'DONE')).toBe(true);

    // T1's killed insert must be gone; only T2's committed session remains (exactly one, not two).
    const [rows] = await appPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM playback_session WHERE strategy = 'STEPPER' AND account_id IN (?) AND status = 'PLAYING'`,
      [view.accountIds],
    );
    expect(Number(rows[0]!.n)).toBe(1);

    const snapshot = await readLocks(appPool, (id) => engine.labelForConnId(id));
    expect(snapshot.locks.filter((l) => l.label === 'T1')).toHaveLength(0);
  });
});

describe('loading while transactions are still open (regression: used to hang)', () => {
  it('load() during a transaction that holds row locks completes promptly and starts clean', async () => {
    await engine.load('PESSIMISTIC_RC');
    await engine.step('T1'); // BEGIN
    await engine.step('T1'); // FOR UPDATE: T1 now holds the account row lock, uncommitted
    const t0 = Date.now();
    const view = await engine.load('RACE_TXN_RR');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(view.scenarioId).toBe('RACE_TXN_RR');
    expect(view.txns.T1.steps.every((s) => s.status === 'PENDING')).toBe(true);
    const locks = await readLocks(appPool, (id) => engine.labelForConnId(id));
    expect(locks.locks.filter((l) => l.label !== 'other')).toHaveLength(0);
  });

  it('load() while a step is WAITING kills that connection, and the stale outcome does not leak into the new scenario', async () => {
    await engine.load('PESSIMISTIC_RC');
    await engine.step('T1'); await engine.step('T1'); // T1 holds the lock
    await engine.step('T2'); // BEGIN
    const waiting = await engine.step('T2'); // FOR UPDATE blocks behind T1
    expect(waiting.status).toBe('WAITING');
    const t0 = Date.now();
    const view = await engine.load('RACE_TXN_RR');
    expect(Date.now() - t0).toBeLessThan(5000);
    await sleep(500); // let the killed statement's rejection arrive
    const after = engine.view();
    expect(after.scenarioId).toBe('RACE_TXN_RR');
    expect(after.txns.T2.busy).toBe(false);
    expect(after.txns.T2.steps.every((s) => s.status === 'PENDING')).toBe(true);
    expect(view.txns.T2.steps).toHaveLength(4);
    // and the fresh scenario is fully usable
    expect((await engine.step('T2')).status).toBe('DONE');
  });

  it('reset() mid-scenario also returns promptly', async () => {
    await engine.load('PESSIMISTIC_RC');
    await engine.step('T1'); await engine.step('T1');
    const t0 = Date.now();
    await engine.reset();
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('lab lock', () => {
  beforeEach(async () => { await engine.load('RACE_TXN_RR'); });

  it('a second load() while one is in flight is rejected', async () => {
    const [a, b] = await Promise.allSettled([engine.load('RACE_TXN_RR'), engine.load('RACE_TXN_RR')]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
  });
});
