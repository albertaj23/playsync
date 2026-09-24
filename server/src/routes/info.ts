// Read-only endpoints used by the demo UI.
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { config } from '../config.js';
import { appPool } from '../db/pool.js';
import { runChecks } from '../services/checks.js';
import { getLiveStrategy, ServiceError } from '../services/playback.js';
import { strategies } from '../strategies/index.js';
import { asyncHandler } from './http.js';

export const infoRouter = Router();

const TABLES = ['account', 'device', 'song', 'playback_session', 'playback_event', 'experiment_run'] as const;

infoRouter.get('/config', (_req, res) => {
  res.json({ leaseMs: config.LEASE_MS, heartbeatMs: config.HEARTBEAT_MS, strategy: getLiveStrategy() });
});

infoRouter.get('/strategies', (_req, res) => {
  res.json(Object.values(strategies).map((s) => ({
    name: s.name, defaultIsolation: s.defaultIsolation,
    supportsMaxStreamsAbove1: s.supportsMaxStreamsAbove1, needsUniqueIndex: s.needsUniqueIndex,
  })));
});

infoRouter.get('/songs', asyncHandler(async (_req, res) => {
  const [rows] = await appPool.query<RowDataPacket[]>(
    'SELECT song_id AS songId, title, artist, duration_ms AS durationMs, play_count AS playCount FROM song ORDER BY song_id');
  res.json(rows);
}));

infoRouter.get('/accounts/lookup', asyncHandler(async (req, res) => {
  const username = z.string().min(1).parse(req.query.username);
  const [rows] = await appPool.query<RowDataPacket[]>(
    'SELECT account_id AS accountId, username, display_name AS displayName FROM account WHERE username = ?', [username]);
  if (!rows[0]) throw new ServiceError(404, 'NOT_FOUND', `no account "${username}"`);
  res.json(rows[0]);
}));

infoRouter.get('/accounts/:id/events', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const limit = z.coerce.number().int().min(1).max(200).default(30).parse(req.query.limit);
  const [rows] = await appPool.query<RowDataPacket[]>(
    `SELECT e.event_id AS eventId, e.event_type AS type, e.device_id AS deviceId, d.device_name AS deviceName,
            e.session_id AS sessionId, e.state_version AS stateVersion, e.client_request_id AS clientRequestId,
            e.detail, DATE_FORMAT(e.created_at, '%H:%i:%s.%f') AS at
     FROM playback_event e LEFT JOIN device d ON d.device_id = e.device_id
     WHERE e.account_id = ? ORDER BY e.event_id DESC LIMIT ?`, [id, limit]);
  res.json(rows.map((r) => ({ ...r, at: String(r.at).slice(0, 12) })));
}));

infoRouter.get('/accounts/:id/checks', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const checks = await runChecks(id);
  res.json({ accountId: id, allPassed: checks.every((c) => c.passed), checks });
}));

infoRouter.get('/db/overview', asyncHandler(async (_req, res) => {
  const counts = await Promise.all(TABLES.map(async (t) => {
    const [rows] = await appPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${t}`);
    return [t, Number(rows[0]!.n)] as const;
  }));
  const [indexes] = await appPool.query<RowDataPacket[]>(
    `SELECT table_name AS tableName, index_name AS indexName, non_unique AS nonUnique,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns
     FROM information_schema.statistics WHERE table_schema = DATABASE()
     GROUP BY table_name, index_name, non_unique ORDER BY table_name, index_name = 'PRIMARY' DESC, index_name`);
  const [fks] = await appPool.query<RowDataPacket[]>(
    `SELECT table_name AS tableName, constraint_name AS name,
            GROUP_CONCAT(column_name ORDER BY ordinal_position) AS columns,
            referenced_table_name AS refTable,
            GROUP_CONCAT(referenced_column_name ORDER BY ordinal_position) AS refColumns
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL
     GROUP BY table_name, constraint_name, referenced_table_name`);
  const [labs] = await appPool.query<RowDataPacket[]>(
    `SELECT SUM(is_lab) AS lab, SUM(username LIKE 'step\\_%') AS stepper, SUM(NOT is_lab AND username NOT LIKE 'step\\_%') AS demo
     FROM account`);
  res.json({
    tables: TABLES.map((t) => ({
      name: t,
      rows: counts.find(([n]) => n === t)![1],
      indexes: indexes.filter((i) => i.tableName === t).map((i) => ({ name: i.indexName, unique: !i.nonUnique, columns: i.columns })),
      foreignKeys: fks.filter((f) => f.tableName === t).map((f) => ({ name: f.name, columns: f.columns, refTable: f.refTable, refColumns: f.refColumns })),
    })),
    accounts: { demo: Number(labs[0]!.demo), lab: Number(labs[0]!.lab), stepper: Number(labs[0]!.stepper) },
  });
}));
