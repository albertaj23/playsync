import express from 'express';
import cors from 'cors';
import { accountsRouter } from './routes/accounts.js';
import { healthRouter } from './routes/health.js';
import { infoRouter } from './routes/info.js';
import { labRouter } from './routes/lab.js';
import { errorHandler } from './routes/http.js';
import { playbackRouter } from './routes/playback.js';
import { stepperRouter } from './routes/stepper.js';
import { simRouter } from './routes/sim.js';

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  // infoRouter before accountsRouter so /accounts/lookup isn't parsed as /accounts/:id.
  app.use('/api', healthRouter, infoRouter, accountsRouter, playbackRouter, labRouter, stepperRouter, simRouter);
  app.use(errorHandler);
  return app;
}
