import { Router } from 'express';
import { z } from 'zod';
import * as playback from '../services/playback.js';
import { asyncHandler } from './http.js';

export const playbackRouter = Router();

const id = z.coerce.number().int().positive();
const position = z.coerce.number().int().min(0);

const ClaimBody = z.object({
  deviceId: id,
  songId: id,
  mode: z.enum(['NORMAL', 'TAKEOVER']).default('NORMAL'),
  clientRequestId: z.string().uuid().optional(),
  positionMs: position.optional(),
});
const SessionBody = z.object({ sessionId: id, deviceId: id, positionMs: position.optional() });
const HeartbeatBody = z.object({ sessionId: id, deviceId: id, positionMs: position });

playbackRouter.post('/playback/claim', asyncHandler(async (req, res) => {
  const result = await playback.claim(ClaimBody.parse(req.body));
  res.status(result.outcome === 'GRANTED' ? 200 : 409).json(result);
}));

playbackRouter.post('/playback/heartbeat', asyncHandler(async (req, res) => {
  const b = HeartbeatBody.parse(req.body);
  res.json(await playback.heartbeat(b.sessionId, b.deviceId, b.positionMs));
}));

playbackRouter.post('/playback/pause', asyncHandler(async (req, res) => {
  const b = SessionBody.parse(req.body);
  res.json(await playback.pause(b.sessionId, b.deviceId, b.positionMs));
}));

playbackRouter.post('/playback/release', asyncHandler(async (req, res) => {
  const b = SessionBody.parse(req.body);
  res.json(await playback.release(b.sessionId, b.deviceId, b.positionMs));
}));
