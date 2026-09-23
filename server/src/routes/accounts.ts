import { Router } from 'express';
import { z } from 'zod';
import { STRATEGY_NAMES } from '../strategies/index.js';
import * as playback from '../services/playback.js';
import { ServiceError } from '../services/playback.js';
import { asyncHandler } from './http.js';

export const accountsRouter = Router();

const Id = z.coerce.number().int().positive();
const Settings = z.object({
  maxStreams: z.coerce.number().int().min(1).max(10),
  conflictPolicy: z.enum(['REJECT', 'TAKEOVER', 'ASK']),
});

accountsRouter.get('/accounts/:id/state', asyncHandler(async (req, res) => {
  const snap = await playback.getSnapshot(Id.parse(req.params.id));
  if (!snap) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
  res.json(snap);
}));

accountsRouter.put('/accounts/:id/settings', asyncHandler(async (req, res) => {
  const b = Settings.parse(req.body);
  res.json(await playback.updateSettings(Id.parse(req.params.id), b.maxStreams, b.conflictPolicy));
}));

accountsRouter.post('/accounts/:id/end-all', asyncHandler(async (req, res) => {
  res.json(await playback.endAll(Id.parse(req.params.id)));
}));

accountsRouter.post('/devices/:id/hello', asyncHandler(async (req, res) => {
  res.json(await playback.deviceHello(Id.parse(req.params.id)));
}));

accountsRouter.get('/admin/strategy', (_req, res) => {
  res.json({ strategy: playback.getLiveStrategy() });
});

accountsRouter.put('/admin/strategy', asyncHandler(async (req, res) => {
  const { strategy } = z.object({ strategy: z.enum(STRATEGY_NAMES) }).parse(req.body);
  await playback.setLiveStrategy(strategy);
  res.json({ strategy });
}));
