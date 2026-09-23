import type { PoolConnection } from 'mysql2/promise';
import type { Isolation, Stats } from '../db/tx.js';

export type { Isolation, Stats };

export const STRATEGY_NAMES = ['NAIVE', 'TXN_RR', 'SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT'] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export type ClaimMode = 'NORMAL' | 'TAKEOVER';

export interface ClaimInput {
  accountId: number; deviceId: number; songId: number;
  mode: ClaimMode;                      // TAKEOVER = preempt the oldest active session(s)
  clientRequestId?: string;             // idempotency key (UUID from client)
  positionMs?: number;                  // where the new session starts (resume after pause)
  isolation?: Isolation;                // lab only: override the strategy's default isolation
  raceDelayMs?: number;                 // lab only: sleep between check and write
  fault?: 'AFTER_SESSION_INSERT';       // recovery demo: throw before commit
}

export interface Holder { sessionId: number; deviceId: number; deviceName: string }

export type ClaimResult =
  | { outcome: 'GRANTED'; sessionId: number; stateVersion: number; preempted: number[] }
  | { outcome: 'REJECTED'; stateVersion: number; holders: Holder[] };

export interface Strategy {
  name: StrategyName;
  defaultIsolation: Isolation | 'AUTOCOMMIT';
  supportsMaxStreamsAbove1: boolean;     // false only for CONSTRAINT
  needsUniqueIndex: boolean;             // true only for CONSTRAINT
  claim(conn: PoolConnection, input: ClaimInput, stats: Stats): Promise<ClaimResult>;
}

/** Thrown when `fault: 'AFTER_SESSION_INSERT'` is set. Never retried. */
export class FaultInjectedError extends Error {
  constructor() {
    super('fault injected after session INSERT, before COMMIT');
    this.name = 'FaultInjectedError';
  }
}
