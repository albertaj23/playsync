import { Router } from 'express';
import { ZodError } from 'zod';
import { LabBusyError } from '../lab/labLock.js';
import { listRuns } from '../lab/persist.js';
import { CAPS, PRESETS, SimConfigError } from '../lab/sim/config.js';
import { simEngine } from '../lab/sim/engine.js';
import { ServiceError } from '../services/playback.js';
import { asyncHandler } from './http.js';

export const simRouter = Router();

function mapSimError(err: unknown): never {
  if (err instanceof LabBusyError) throw new ServiceError(409, 'BUSY', 'Another experiment is running.');
  if (err instanceof SimConfigError) throw new ServiceError(400, 'BAD_PARAMS', err.message);
  if (err instanceof ZodError) throw err;
  throw err;
}

simRouter.get('/lab/sim/presets', (_req, res) => { res.json({ presets: PRESETS, caps: CAPS }); });
simRouter.get('/lab/sim/state', (_req, res) => { res.json(simEngine.snapshot()); });

simRouter.post('/lab/sim/start', asyncHandler(async (req, res) => {
  try { res.json(await simEngine.start(req.body)); } catch (err) { mapSimError(err); }
}));
simRouter.post('/lab/sim/pause', (_req, res) => { res.json(simEngine.pause()); });
simRouter.post('/lab/sim/resume', (_req, res) => { res.json(simEngine.resume()); });
simRouter.post('/lab/sim/stop', asyncHandler(async (_req, res) => { res.json(await simEngine.stop()); }));

simRouter.patch('/lab/sim/config', asyncHandler(async (req, res) => {
  try { res.json(await simEngine.patch(req.body)); } catch (err) { mapSimError(err); }
}));

simRouter.post('/lab/sim/repair', asyncHandler(async (_req, res) => {
  try { res.json(await simEngine.repair()); } catch (err) { mapSimError(err); }
}));

simRouter.get('/lab/sim/runs/:batchId', asyncHandler(async (req, res) => {
  const rows = await listRuns({ batchId: String(req.params.batchId), limit: 1 });
  if (!rows[0]) throw new ServiceError(404, 'NOT_FOUND', 'no such simulation run');
  res.json(rows[0].detail);
}));

simRouter.get('/lab/sim/runs', asyncHandler(async (_req, res) => {
  const rows = (await listRuns({ experiment: 'STREAM_LIMIT', limit: 200 })).filter((r) => r.source === 'SIM');
  res.json(rows.map((r) => ({ batchId: r.batchId, createdAt: r.createdAt, strategy: r.strategy, violations: r.violations, p95Ms: r.p95Ms })));
}));
