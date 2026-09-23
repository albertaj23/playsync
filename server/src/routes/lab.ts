import { Router } from 'express';
import { z } from 'zod';
import { ISOLATIONS } from '../db/tx.js';
import { RaceParamError, runRace } from '../lab/raceRunner.js';
import { getLiveStrategy, ServiceError } from '../services/playback.js';
import { STRATEGY_NAMES } from '../strategies/index.js';
import { asyncHandler } from './http.js';

export const labRouter = Router();

const RaceBody = z.object({
  strategy: z.enum(STRATEGY_NAMES),
  isolation: z.enum(ISOLATIONS as [string, ...string[]]).optional(),
  concurrency: z.coerce.number().int().min(2).max(100).default(30),
  accounts: z.coerce.number().int().min(1).max(16).default(1),
  maxStreams: z.coerce.number().int().min(1).max(10).default(1),
  raceDelayMs: z.coerce.number().int().min(0).max(200).default(20),
  mode: z.enum(['NORMAL', 'TAKEOVER']).default('NORMAL'),
});

// One race at a time: two overlapping runs would reset each other's lab accounts.
let running = false;

labRouter.post('/lab/race', asyncHandler(async (req, res) => {
  const params = RaceBody.parse(req.body) as z.infer<typeof RaceBody> & { isolation?: (typeof ISOLATIONS)[number] };
  if (running) throw new ServiceError(409, 'BUSY', 'a race is already running');
  running = true;
  try {
    res.json(await runRace(params, getLiveStrategy()));
  } catch (err) {
    if (err instanceof RaceParamError) throw new ServiceError(400, 'BAD_PARAMS', err.message);
    throw err;
  } finally {
    running = false;
  }
}));
