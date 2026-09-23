import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePools } from '../src/db/pool.js';

afterAll(closePools);

describe('GET /api/health', () => {
  it('reports the MySQL version', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db.version).toMatch(/^8\.4\./);
    expect(res.body.db.name).toBe('playsync');
  });
});
