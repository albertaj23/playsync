// Shared types for the Transaction Stepper (PLAN.md §8.3).

import type { Isolation } from '../../db/tx.js';

export type TxnLabel = 'T1' | 'T2';

/** What a step displays before it runs. Values a statement depends on are shown as {name}. */
export interface ScenarioStep {
  /** Static text shown before the step has run (e.g. "UPDATE account SET state_version = state_version + 1 WHERE account_id = 5 AND state_version = {v}"). */
  display: string;
  /** Builds the exact runnable SQL from values captured from this transaction's own earlier steps. */
  sql: (ctx: Record<string, unknown>) => string;
  /** After the step runs successfully, merges these into the transaction's context for later steps. */
  capture?: (rows: unknown) => Record<string, unknown>;
}

export const step = (sql: string): ScenarioStep => ({ display: sql, sql: () => sql });

/** Ids resolved once when a scenario is loaded, from the live database (never hard-coded). */
export interface ScenarioContext {
  accountA: number; accountB: number;
  deviceA1: number; deviceA2: number;
  songId: number;
  accountLo: number; accountHi: number; // min/max of accountA/accountB, for lock-ordering demos
}

export interface BuiltScenario {
  isolation: Record<TxnLabel, Isolation>;
  steps: Record<TxnLabel, ScenarioStep[]>;
  /** Accounts the invariant check (and the UI) should watch for this scenario. */
  accountIds: number[];
}

export interface Scenario {
  id: string;
  title: string;
  syllabusRefs: string[];
  expected: string;
  explanation: string;
  /** The order a first-time user should press Step in, alternating T1/T2 labels (and 'KILL_T1' etc. for kill scenarios). */
  suggestedOrder: string[];
  build: (ctx: ScenarioContext) => BuiltScenario;
}

export type StepStatus = 'PENDING' | 'WAITING' | 'DONE' | 'ERROR' | 'KILLED';

export interface StepResultView {
  index: number;
  display: string;
  status: StepStatus;
  resolvedSql?: string;
  rows?: unknown;
  affectedRows?: number;
  errno?: number;
  errorMessage?: string;
  deadlockText?: string;
}

export interface TxnView {
  label: TxnLabel;
  connId: number | null;
  isolation: Isolation | null;
  killed: boolean;
  busy: boolean;
  steps: StepResultView[];
  cursor: number;
}

export interface StepperStateView {
  scenarioId: string | null;
  accountIds: number[];
  txns: Record<TxnLabel, TxnView>;
}

export interface StepperUpdate {
  txn: TxnLabel;
  index: number;
  result: StepResultView | null;
  killed?: boolean;
}
