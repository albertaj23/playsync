// The seven stepper scenarios from PLAN.md §8.3, plus ORDERED_LOCKING (the variant of
// CLASSIC_DEADLOCK the plan describes inline). Each scenario is data: two lists of SQL
// statements, one per transaction, run in a suggested order that produces one specific,
// reproducible outcome. All ids/values come from `ScenarioContext`, resolved from the live
// database when the scenario loads - nothing here is hard-coded.
//
// Every step's `display` text is exactly what runs, EXCEPT OPTIMISTIC_CAS's compare-and-set
// UPDATEs: their WHERE value depends on what that transaction itself read moments earlier, which
// cannot be known until the read step actually executes. Those show a `{v}` placeholder before
// they run; the executed SQL (with the real captured value substituted) is shown once they have.

import type { RowDataPacket } from 'mysql2/promise';
import type { BuiltScenario, Scenario, ScenarioContext, ScenarioStep, TxnLabel } from './types.js';
import { step } from './types.js';

const STRATEGY = 'STEPPER';
const LEASE = "NOW(3) + INTERVAL 15 SECOND";

const beginStep = step('BEGIN');
const commitStep = step('COMMIT');
const rollbackStep = step('ROLLBACK');

const countActive = (account: number): ScenarioStep => step(
  `SELECT COUNT(*) AS active FROM playback_session WHERE account_id = ${account} AND status = 'PLAYING' AND lease_expires_at > NOW(3)`,
);
const insertSession = (account: number, device: number, song: number): ScenarioStep => step(
  `INSERT INTO playback_session (account_id, device_id, song_id, status, lease_expires_at, strategy) VALUES (${account}, ${device}, ${song}, 'PLAYING', ${LEASE}, '${STRATEGY}')`,
);
const lockAccountRow = (account: number): ScenarioStep => step(
  `SELECT account_id FROM account WHERE account_id = ${account} FOR UPDATE`,
);
const lockAccountBalance = (account: number): ScenarioStep => step(
  `SELECT max_streams FROM account WHERE account_id = ${account} FOR UPDATE`,
);
const readVersion = (account: number): ScenarioStep => ({
  display: `SELECT state_version FROM account WHERE account_id = ${account}`,
  sql: () => `SELECT state_version FROM account WHERE account_id = ${account}`,
  capture: (rows) => ({ v: Number((rows as RowDataPacket[])[0]!.state_version) }),
});
const casVersion = (account: number): ScenarioStep => ({
  display: `UPDATE account SET state_version = state_version + 1 WHERE account_id = ${account} AND state_version = {v}`,
  sql: (ctx) => `UPDATE account SET state_version = state_version + 1 WHERE account_id = ${account} AND state_version = ${ctx.v}`,
});

const M = {
  schedules: 'M5 schedules', serializability: 'M5 serializability', recovery: 'M5 recovery',
  twoPL: 'M6 2PL', deadlockDetect: 'M6 deadlock detection', deadlockPrevent: 'M6 deadlock prevention',
  occ: 'M6 optimistic concurrency',
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'RACE_TXN_RR',
    title: 'Write skew at REPEATABLE READ',
    syllabusRefs: [M.schedules, M.serializability],
    expected: 'Both transactions commit. The invariant check afterwards shows 2 active sessions on a 1-stream account: violated.',
    explanation:
      "Both transactions count 0 active sessions (a fair snapshot read, since neither has written yet), so both decide it's safe to insert. REPEATABLE READ's own snapshot isolation doesn't stop this: it guarantees each transaction sees a consistent snapshot, not that two transactions can't both act on the same fact.",
    suggestedOrder: ['T1', 'T2', 'T1', 'T2', 'T1', 'T2', 'T1', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'REPEATABLE READ', T2: 'REPEATABLE READ' },
      steps: {
        T1: [beginStep, countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA1, ctx.songId), commitStep],
        T2: [beginStep, countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA2, ctx.songId), commitStep],
      },
      accountIds: [ctx.accountA],
    }),
  },
  {
    id: 'PESSIMISTIC_RC',
    title: 'Locking the account row (the fix)',
    syllabusRefs: [M.twoPL],
    expected: "T2's FOR UPDATE waits until T1 commits, then correctly sees 1 active session and rejects.",
    explanation:
      "T1 locks the account row first, so T2's own FOR UPDATE on the same row must wait. By the time T2 gets the lock, T1 has committed, so T2's count is accurate at READ COMMITTED (each statement reads the latest committed data) and it correctly rejects.",
    suggestedOrder: ['T1', 'T1', 'T2', 'T2', 'T1', 'T1', 'T1', 'T2', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'READ COMMITTED', T2: 'READ COMMITTED' },
      steps: {
        T1: [beginStep, lockAccountRow(ctx.accountA), countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA1, ctx.songId), commitStep],
        T2: [beginStep, lockAccountRow(ctx.accountA), countActive(ctx.accountA), rollbackStep],
      },
      accountIds: [ctx.accountA],
    }),
  },
  {
    id: 'PESSIMISTIC_RR_PITFALL',
    title: 'Locking too late at REPEATABLE READ (the pitfall)',
    syllabusRefs: [M.schedules, M.twoPL],
    expected: 'T1 locks the account row AFTER already counting, so its later re-count still returns 0 from its frozen snapshot. Both commit: violated, despite the FOR UPDATE.',
    explanation:
      "T1's first statement is a plain SELECT, which fixes its REPEATABLE READ snapshot at 0 active sessions. Locking the account row afterwards doesn't help: T1's later count still reads from that same frozen snapshot, not from what's true now. This is why PESSIMISTIC in the real strategies locks the account row FIRST, before any read.",
    suggestedOrder: ['T1', 'T1', 'T2', 'T2', 'T1', 'T2', 'T2', 'T1', 'T1', 'T1'],
    build: (ctx) => ({
      isolation: { T1: 'REPEATABLE READ', T2: 'REPEATABLE READ' },
      steps: {
        T1: [beginStep, countActive(ctx.accountA), lockAccountRow(ctx.accountA), countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA1, ctx.songId), commitStep],
        T2: [beginStep, lockAccountRow(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA2, ctx.songId), commitStep],
      },
      accountIds: [ctx.accountA],
    }),
  },
  {
    id: 'SERIALIZABLE_DEADLOCK',
    title: 'SERIALIZABLE turns the race into a deadlock',
    syllabusRefs: [M.serializability, M.deadlockDetect],
    expected: 'Both counts succeed (compatible shared locks). Both inserts wait on each other; InnoDB detects the cycle and kills one with error 1213. The survivor commits.',
    explanation:
      "Under SERIALIZABLE, InnoDB turns the plain SELECT into a shared next-key lock, so both counts succeed (S locks are compatible with each other). But each INSERT needs an insert-intention lock on the range the other transaction has S-locked - now they wait on each other's locks, a genuine wait-for cycle. InnoDB's deadlock detector picks a victim and rolls it back; watch the wait-for graph turn red just before this happens.",
    suggestedOrder: ['T1', 'T2', 'T1', 'T2', 'T1', 'T2', 'T1', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'SERIALIZABLE', T2: 'SERIALIZABLE' },
      steps: {
        T1: [beginStep, countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA1, ctx.songId), commitStep],
        T2: [beginStep, countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA2, ctx.songId), commitStep],
      },
      accountIds: [ctx.accountA],
    }),
  },
  {
    id: 'OPTIMISTIC_CAS',
    title: 'Optimistic concurrency: validate with a compare-and-set',
    syllabusRefs: [M.occ],
    expected: "T1's CAS matches and commits. T2's CAS affects 0 rows (the version already moved), so T2 aborts.",
    explanation:
      'Both transactions read state_version without taking any lock. T1 writes back first, bumping the version - its own compare-and-set UPDATE still matches what it read, so it succeeds and briefly holds an X lock on the account row just for that UPDATE. T2 committed to a version that is no longer current, so its own CAS UPDATE matches 0 rows: the same statement is the validation.',
    suggestedOrder: ['T1', 'T2', 'T1', 'T2', 'T1', 'T1', 'T2', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'READ COMMITTED', T2: 'READ COMMITTED' },
      steps: {
        T1: [beginStep, readVersion(ctx.accountA), casVersion(ctx.accountA), commitStep],
        T2: [beginStep, readVersion(ctx.accountA), casVersion(ctx.accountA), rollbackStep],
      },
      accountIds: [ctx.accountA],
    }),
  },
  {
    id: 'CLASSIC_DEADLOCK',
    title: 'Classic deadlock: locking two rows in different orders',
    syllabusRefs: [M.deadlockDetect],
    expected: 'T1 locks A then reaches for B; T2 locks B then reaches for A. Neither can proceed: InnoDB detects the cycle and kills one.',
    explanation:
      "A 'family-plan transfer': T1 locks account A, then wants B. T2 locks B first, then wants A. Each holds what the other needs - a deadlock with nothing to do with the invariant, just two ordinary row locks taken in opposite orders. Compare with ORDERED_LOCKING, which fixes this by fixing a lock order.",
    suggestedOrder: ['T1', 'T2', 'T1', 'T2', 'T1', 'T2', 'T1', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'READ COMMITTED', T2: 'READ COMMITTED' },
      steps: {
        T1: [beginStep, lockAccountBalance(ctx.accountA), lockAccountBalance(ctx.accountB), commitStep],
        T2: [beginStep, lockAccountBalance(ctx.accountB), lockAccountBalance(ctx.accountA), commitStep],
      },
      accountIds: [ctx.accountA, ctx.accountB],
    }),
  },
  {
    id: 'ORDERED_LOCKING',
    title: 'Deadlock prevention: always lock the lower id first',
    syllabusRefs: [M.deadlockPrevent],
    expected: 'Both transactions lock the same account first (the lower id). T2 simply waits for T1 to finish; no deadlock.',
    explanation:
      'Same two accounts, same two transactions - but both now lock the lower account_id first. T2 can only ever be BLOCKED, never DEADLOCKED, because the two transactions never hold locks the other needs in opposite orders. This is deadlock prevention by resource ordering, the standard fix for CLASSIC_DEADLOCK.',
    suggestedOrder: ['T1', 'T2', 'T1', 'T2', 'T1', 'T1', 'T2', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'READ COMMITTED', T2: 'READ COMMITTED' },
      steps: {
        T1: [beginStep, lockAccountBalance(ctx.accountLo), lockAccountBalance(ctx.accountHi), commitStep],
        T2: [beginStep, lockAccountBalance(ctx.accountLo), lockAccountBalance(ctx.accountHi), commitStep],
      },
      accountIds: [ctx.accountA, ctx.accountB],
    }),
  },
  {
    id: 'KILL_RECOVERY',
    title: 'KILL and recovery via the undo log',
    syllabusRefs: [M.recovery],
    expected: "T1 inserts but never commits. T2 (READ COMMITTED) doesn't see the uncommitted row. Kill T1: its locks and row vanish. T2 proceeds.",
    explanation:
      "T1's INSERT succeeds and its locks are now visible in the lock table, but it never runs COMMIT. T2, reading at READ COMMITTED, doesn't see uncommitted data, so it counts 0. Press Kill T1: MySQL forcibly closes that connection, and InnoDB uses the undo log to roll back the open transaction automatically - the row disappears and the locks release, exactly as a normal ROLLBACK would.",
    suggestedOrder: ['T1', 'T1', 'T2', 'T2', 'KILL_T1', 'T2', 'T2'],
    build: (ctx) => ({
      isolation: { T1: 'READ COMMITTED', T2: 'READ COMMITTED' },
      steps: {
        T1: [beginStep, insertSession(ctx.accountA, ctx.deviceA1, ctx.songId)],
        T2: [beginStep, countActive(ctx.accountA), insertSession(ctx.accountA, ctx.deviceA2, ctx.songId), commitStep],
      },
      accountIds: [ctx.accountA],
    }),
  },
];

export function getScenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario: ${id}`);
  return s;
}

export function buildScenario(id: string, ctx: ScenarioContext): BuiltScenario {
  return getScenario(id).build(ctx);
}

export type { TxnLabel };
