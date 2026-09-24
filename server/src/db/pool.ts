import mysql, { type ConnectionOptions, type Pool, type PoolOptions } from 'mysql2/promise';
import { config } from '../config.js';

/**
 * Shared connection options, also used for the Transaction Stepper's dedicated unpooled
 * connections (server/src/lab/stepper/engine.ts) so they behave identically to pooled ones.
 */
export const dbConnectionOptions: ConnectionOptions = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  supportBigNumbers: true,
  // All time comparisons happen in SQL with NOW(3); the driver never compares times itself.
  timezone: 'Z',
};

const base: PoolOptions = {
  ...dbConnectionOptions,
  waitForConnections: true,
  queueLimit: 0,
};

/** Pool for the live app (REST handlers, reaper). */
export const appPool: Pool = mysql.createPool({ ...base, connectionLimit: config.APP_POOL_SIZE });

/**
 * Pool for the Concurrency Lab. Must be at least as large as the highest lab concurrency,
 * otherwise requests queue at the pool and the race window disappears (PLAN.md §8.1).
 */
export const labPool: Pool = mysql.createPool({ ...base, connectionLimit: config.LAB_POOL_SIZE });

export async function closePools(): Promise<void> {
  await Promise.all([appPool.end(), labPool.end()]);
}
