import { Router } from 'express';
import { z } from 'zod';
import { ISOLATIONS, type Isolation } from '../db/tx.js';
import { LabBusyError } from '../lab/labLock.js';
import { LOST_UPDATE_VARIANTS, LostUpdateParamError, runLostUpdateExperiment } from '../lab/lostUpdate.js';
import { listRuns } from '../lab/persist.js';
import { RaceParamError, runStreamLimitExperiment } from '../lab/raceRunner.js';
import { getLiveStrategy, ServiceError } from '../services/playback.js';
import { STRATEGY_NAMES } from '../strategies/index.js';
import { asyncHandler } from './http.js';

export const labRouter = Router();

function mapLabError(err: unknown): never {
  if (err instanceof RaceParamError || err instanceof LostUpdateParamError) {
    throw new ServiceError(400, 'BAD_PARAMS', err.message);
  }
  if (err instanceof LabBusyError) throw new ServiceError(409, 'BUSY', err.message);
  throw err;
}

const IsolationEnum = z.enum(ISOLATIONS as [Isolation, ...Isolation[]]);

// -------------------------------------------------------------- POST /lab/race (single trial)

const RaceBody = z.object({
  strategy: z.enum(STRATEGY_NAMES),
  isolation: IsolationEnum.optional(),
  concurrency: z.coerce.number().int().min(2).max(100).default(30),
  accounts: z.coerce.number().int().min(1).max(16).default(1),
  maxStreams: z.coerce.number().int().min(1).max(10).default(1),
  raceDelayMs: z.coerce.number().int().min(0).max(200).default(20),
  mode: z.enum(['NORMAL', 'TAKEOVER']).default('NORMAL'),
  batchId: z.string().uuid().optional(),
});

labRouter.post('/lab/race', asyncHandler(async (req, res) => {
  const body = RaceBody.parse(req.body);
  try {
    const { trials } = await runStreamLimitExperiment(
      { ...body, trials: 1, source: 'UI' }, getLiveStrategy(),
    );
    res.json(trials[0]!);
  } catch (err) {
    mapLabError(err);
  }
}));

// -------------------------------------------------------------- POST /lab/experiments (trials, full control)

const ExperimentBody = z.object({
  strategy: z.enum(STRATEGY_NAMES),
  isolation: IsolationEnum.optional(),
  concurrency: z.coerce.number().int().min(2).max(100).default(30),
  accounts: z.coerce.number().int().min(1).max(16).default(1),
  maxStreams: z.coerce.number().int().min(1).max(10).default(1),
  raceDelayMs: z.coerce.number().int().min(0).max(200).default(20),
  mode: z.enum(['NORMAL', 'TAKEOVER']).default('NORMAL'),
  trials: z.coerce.number().int().min(1).max(50).default(10),
  batchId: z.string().uuid().optional(),
});

labRouter.post('/lab/experiments', asyncHandler(async (req, res) => {
  const body = ExperimentBody.parse(req.body);
  try {
    const result = await runStreamLimitExperiment({ ...body, source: 'API' }, getLiveStrategy());
    res.json(result);
  } catch (err) {
    mapLabError(err);
  }
}));

// -------------------------------------------------------------- POST /lab/lost-update

const LostUpdateBody = z.object({
  variant: z.enum(LOST_UPDATE_VARIANTS),
  increments: z.coerce.number().int().min(2).max(100).default(50),
  raceDelayMs: z.coerce.number().int().min(0).max(200).default(20),
  trials: z.coerce.number().int().min(1).max(20).default(5),
  batchId: z.string().uuid().optional(),
});

labRouter.post('/lab/lost-update', asyncHandler(async (req, res) => {
  const body = LostUpdateBody.parse(req.body);
  try {
    const result = await runLostUpdateExperiment({ ...body, source: 'API' });
    res.json(result);
  } catch (err) {
    mapLabError(err);
  }
}));

// -------------------------------------------------------------- GET /lab/runs

const RunsQuery = z.object({
  experiment: z.enum(['STREAM_LIMIT', 'LOST_UPDATE']).optional(),
  batchId: z.string().optional(),
  strategy: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

labRouter.get('/lab/runs', asyncHandler(async (req, res) => {
  const q = RunsQuery.parse(req.query);
  res.json(await listRuns(q));
}));
