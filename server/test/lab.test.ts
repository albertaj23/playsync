import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { appPool, closePools } from '../src/db/pool.js';
import { withLabLock } from '../src/lab/labLock.js';
import { runLostUpdateExperiment } from '../src/lab/lostUpdate.js';
import { RaceParamError, runStreamLimitExperiment } from '../src/lab/raceRunner.js';
import { setUniqueIndex } from '../src/strategies/constraint.js';
import { count, resetAccount } from './helpers.js';

const app = createApp();
const LONG = 180_000;

const uniqueIndexPresent = () => count(
  `SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
   AND table_name = 'playback_session' AND index_name = 'uq_one_active_per_account'`,
);

afterAll(async () => {
  const conn = await appPool.getConnection();
  await setUniqueIndex(conn, false).finally(() => conn.release());
  await resetAccount('lab_01');
  await closePools();
});

describe('runStreamLimitExperiment: safe strategies never violate', () => {
  it.each(['PESSIMISTIC', 'OPTIMISTIC', 'SERIALIZABLE', 'CONSTRAINT'] as const)(
    '%s: 20 trials x 50 concurrent claims, 0 violations every trial',
    async (strategy) => {
      const { trials } = await runStreamLimitExperiment(
        { strategy, concurrency: 50, accounts: 1, maxStreams: 1, raceDelayMs: 20, mode: 'NORMAL', trials: 20, source: 'TEST' },
        'PESSIMISTIC',
      );
      expect(trials).toHaveLength(20);
      for (const t of trials) expect(t.violations).toBe(0);
    },
    LONG,
  );
});

describe('runStreamLimitExperiment: unsafe strategies violate', () => {
  it.each(['NAIVE', 'TXN_RR'] as const)(
    '%s (default isolation): violates in at least one of 5 trials',
    async (strategy) => {
      const { trials, aggregate } = await runStreamLimitExperiment(
        { strategy, concurrency: 50, accounts: 1, maxStreams: 1, raceDelayMs: 20, mode: 'NORMAL', trials: 5, source: 'TEST' },
        'PESSIMISTIC',
      );
      expect(trials).toHaveLength(5);
      expect(aggregate.trialsWithViolations).toBeGreaterThan(0);
    },
    LONG,
  );

  it('TXN_RR at READ COMMITTED also violates (H1: RC and RR both fail)', async () => {
    const { aggregate } = await runStreamLimitExperiment(
      { strategy: 'TXN_RR', isolation: 'READ COMMITTED', concurrency: 50, accounts: 1, maxStreams: 1,
        raceDelayMs: 20, mode: 'NORMAL', trials: 5, source: 'TEST' },
      'PESSIMISTIC',
    );
    expect(aggregate.trialsWithViolations).toBeGreaterThan(0);
  }, LONG);
});

describe('TAKEOVER mode', () => {
  it.each(['PESSIMISTIC', 'OPTIMISTIC', 'SERIALIZABLE', 'CONSTRAINT'] as const)(
    '%s: final state satisfies the invariant even when every claim may be granted',
    async (strategy) => {
      const { trials } = await runStreamLimitExperiment(
        { strategy, concurrency: 30, accounts: 1, maxStreams: 1, raceDelayMs: 20, mode: 'TAKEOVER', trials: 5, source: 'TEST' },
        'PESSIMISTIC',
      );
      expect(trials).toHaveLength(5);
      for (const t of trials) expect(t.violations).toBe(0);
      // Some requests may legitimately exhaust withRetry's 5 attempts under TAKEOVER contention;
      // that shows up as `errors`, not a violation.
    },
    LONG,
  );
});

describe('persistence', () => {
  it('writes one experiment_run row per trial, all sharing one batch_id', async () => {
    const { batchId, trials } = await runStreamLimitExperiment(
      { strategy: 'PESSIMISTIC', concurrency: 10, accounts: 1, maxStreams: 1, raceDelayMs: 5, mode: 'NORMAL', trials: 3, source: 'TEST' },
      'PESSIMISTIC',
    );
    expect(trials.map((t) => t.trial)).toEqual([1, 2, 3]);
    for (const t of trials) expect(t.batchId).toBe(batchId);

    const res = await request(app).get(`/api/lab/runs?batchId=${batchId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    for (const row of res.body) {
      expect(row.experiment).toBe('STREAM_LIMIT');
      expect(row.strategy).toBe('PESSIMISTIC');
      expect(row.source).toBe('TEST');
      expect(typeof row.p95Ms).toBe('number');
      expect(typeof row.wallMs).toBe('number');
    }
  });
});

describe('guards', () => {
  it('rejects concurrency above LAB_POOL_SIZE', async () => {
    await expect(runStreamLimitExperiment(
      { strategy: 'PESSIMISTIC', concurrency: config.LAB_POOL_SIZE + 1, accounts: 16, maxStreams: 1,
        raceDelayMs: 0, mode: 'NORMAL', trials: 1, source: 'TEST' },
      'PESSIMISTIC',
    )).rejects.toBeInstanceOf(RaceParamError);
  });

  it('rejects CONSTRAINT with max_streams > 1 without touching the index', async () => {
    const conn = await appPool.getConnection();
    await setUniqueIndex(conn, false).finally(() => conn.release());
    await expect(runStreamLimitExperiment(
      { strategy: 'CONSTRAINT', concurrency: 10, accounts: 1, maxStreams: 2, raceDelayMs: 0, mode: 'NORMAL', trials: 1, source: 'TEST' },
      'PESSIMISTIC',
    )).rejects.toBeInstanceOf(RaceParamError);
    expect(await uniqueIndexPresent()).toBe(0);
  });
});

describe('index restore', () => {
  it('CONSTRAINT experiment restores the index to absent for PESSIMISTIC', async () => {
    await runStreamLimitExperiment(
      { strategy: 'CONSTRAINT', concurrency: 10, accounts: 1, maxStreams: 1, raceDelayMs: 0, mode: 'NORMAL', trials: 1, source: 'TEST' },
      'PESSIMISTIC',
    );
    expect(await uniqueIndexPresent()).toBe(0);
  });

  it('PESSIMISTIC experiment restores the index to present for CONSTRAINT', async () => {
    await runStreamLimitExperiment(
      { strategy: 'PESSIMISTIC', concurrency: 10, accounts: 1, maxStreams: 1, raceDelayMs: 0, mode: 'NORMAL', trials: 1, source: 'TEST' },
      'CONSTRAINT',
    );
    expect(await uniqueIndexPresent()).toBe(1);
    const conn = await appPool.getConnection();
    await setUniqueIndex(conn, false).finally(() => conn.release());
  });
});

describe('lab lock', () => {
  it('a second withLabLock throws LabBusyError while the first is held; the lock frees afterwards', async () => {
    let releaseFirst!: () => void;
    const held = new Promise<void>((r) => { releaseFirst = r; });
    const first = withLabLock(() => held);

    // Give the first call a moment to actually acquire the lock before the second tries.
    await new Promise((r) => setTimeout(r, 50));
    await expect(withLabLock(async () => 'never')).rejects.toThrow('another experiment is running');

    releaseFirst();
    await first;

    await expect(withLabLock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('lost update', () => {
  it('NAIVE_RMW loses increments in at least one of 3 trials', async () => {
    const { trials } = await runLostUpdateExperiment(
      { variant: 'NAIVE_RMW', increments: 50, raceDelayMs: 20, trials: 3, source: 'TEST' },
    );
    expect(trials).toHaveLength(3);
    expect(trials.some((t) => t.lost > 0)).toBe(true);
  }, LONG);

  it.each(['ATOMIC', 'LOCKED', 'CAS'] as const)(
    '%s: ends at exactly N in every trial',
    async (variant) => {
      const { trials } = await runLostUpdateExperiment(
        { variant, increments: 50, raceDelayMs: 20, trials: 3, source: 'TEST' },
      );
      expect(trials).toHaveLength(3);
      for (const t of trials) {
        expect(t.finalCount).toBe(50);
        expect(t.lost).toBe(0);
        if (variant === 'CAS') expect(t.errors).toBe(0);
      }
    },
    LONG,
  );
});
