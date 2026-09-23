import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { appPool } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    const [rows] = await appPool.query<RowDataPacket[]>(
      'SELECT VERSION() AS version, DATABASE() AS db, @@transaction_isolation AS isolation, NOW(3) AS now',
    );
    const r = rows[0]!;
    res.json({ ok: true, db: { version: r.version, name: r.db, defaultIsolation: r.isolation, now: r.now } });
  } catch (err) {
    res.status(503).json({ ok: false, error: (err as Error).message });
  }
});
