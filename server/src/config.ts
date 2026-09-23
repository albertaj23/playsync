import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// .env lives at the repo root, one level above the server workspace.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
dotenv.config({ path: rootEnv });

const STRATEGIES = ['NAIVE', 'TXN_RR', 'SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT'] as const;

const EnvSchema = z.object({
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3307),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root'),
  DB_NAME: z.string().default('playsync'),
  PORT: z.coerce.number().int().positive().default(4000),
  LEASE_MS: z.coerce.number().int().positive().default(15_000),
  HEARTBEAT_MS: z.coerce.number().int().positive().default(5_000),
  REAPER_MS: z.coerce.number().int().positive().default(2_000),
  DEFAULT_STRATEGY: z.enum(STRATEGIES).default('PESSIMISTIC'),
  APP_POOL_SIZE: z.coerce.number().int().positive().default(20),
  LAB_POOL_SIZE: z.coerce.number().int().positive().default(120),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
