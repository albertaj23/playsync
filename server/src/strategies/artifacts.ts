import type { PoolConnection } from 'mysql2/promise';
import { setUniqueIndex } from './constraint.js';
import { setTrigger } from './trigger.js';
import { strategies } from './index.js';
import type { StrategyName } from './types.js';

/** Puts the schema artifacts (unique index, trigger) into the state `name` needs, and removes every other one. */
export async function prepareForStrategy(conn: PoolConnection, name: StrategyName): Promise<void> {
  await setUniqueIndex(conn, strategies[name].needsUniqueIndex);
  await setTrigger(conn, name === 'TRIGGER');
}
