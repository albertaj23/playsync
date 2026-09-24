import { Router } from 'express';
import { z } from 'zod';
import { appPool } from '../db/pool.js';
import { NamedLockBusyError } from '../db/namedLock.js';
import { checkInvariant } from '../lab/invariant.js';
import { engine, scenarioList } from '../lab/stepper/engine.js';
import { readLocks } from '../lab/stepper/locks.js';
import { ServiceError } from '../services/playback.js';
import { asyncHandler } from './http.js';

export const stepperRouter = Router();

function mapStepperError(err: unknown): never {
  if (err instanceof NamedLockBusyError) throw new ServiceError(409, 'BUSY', err.message);
  if (err instanceof Error) throw new ServiceError(400, 'STEPPER_ERROR', err.message);
  throw err;
}

const TxnBody = z.object({ txn: z.enum(['T1', 'T2']) });

stepperRouter.get('/lab/stepper/scenarios', (_req, res) => {
  res.json(scenarioList());
});

stepperRouter.post('/lab/stepper/load', asyncHandler(async (req, res) => {
  const { scenarioId } = z.object({ scenarioId: z.string() }).parse(req.body);
  try {
    res.json(await engine.load(scenarioId));
  } catch (err) {
    mapStepperError(err);
  }
}));

stepperRouter.post('/lab/stepper/step', asyncHandler(async (req, res) => {
  const { txn } = TxnBody.parse(req.body);
  try {
    res.json(await engine.step(txn));
  } catch (err) {
    mapStepperError(err);
  }
}));

stepperRouter.post('/lab/stepper/kill', asyncHandler(async (req, res) => {
  const { txn } = TxnBody.parse(req.body);
  try {
    res.json(await engine.kill(txn));
  } catch (err) {
    mapStepperError(err);
  }
}));

stepperRouter.post('/lab/stepper/reset', asyncHandler(async (_req, res) => {
  try {
    res.json(await engine.reset());
  } catch (err) {
    mapStepperError(err);
  }
}));

stepperRouter.get('/lab/stepper/state', (_req, res) => {
  res.json(engine.view());
});

stepperRouter.get('/lab/stepper/invariant', asyncHandler(async (_req, res) => {
  const accountIds = engine.view().accountIds;
  res.json(await checkInvariant(appPool, accountIds));
}));

stepperRouter.get('/lab/locks', asyncHandler(async (_req, res) => {
  res.json(await readLocks(appPool, (connId) => engine.labelForConnId(connId)));
}));
