import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { isFkViolation } from '../db/errors.js';
import { ServiceError, SessionLostError } from '../services/playback.js';

/** Express 4 does not catch rejected promises; forward them to the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
    (req, res, next) => { fn(req, res, next).catch(next); };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ code: 'BAD_REQUEST', issues: err.issues });
  } else if (err instanceof SessionLostError) {
    res.status(410).json({ code: 'SESSION_LOST', reason: err.reason });
  } else if (err instanceof ServiceError) {
    res.status(err.status).json({ code: err.code, message: err.message, ...err.extra });
  } else if (isFkViolation(err)) {
    res.status(400).json({ code: 'BAD_REFERENCE', message: 'unknown device, song or account' });
  } else {
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: (err as Error).message });
  }
};
