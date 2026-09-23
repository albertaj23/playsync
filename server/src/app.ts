import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', healthRouter);
  return app;
}
