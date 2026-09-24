// Transaction Stepper engine (PLAN.md §8.3): two dedicated, unpooled MySQL connections (T1, T2)
// plus one admin connection, stepped one SQL statement at a time from the browser. This module
// is a singleton: the whole app has one stepper session, matching the UI (one pair of columns).
//
// A step is sent without blocking the HTTP response: if it hasn't finished within 300ms, the
// route responds WAITING and this module pushes the real outcome later via emitStepperUpdate()
// when the query actually settles (PLAN.md's fencing rule for slow/blocked statements).

import mysql, { type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { dbConnectionOptions } from '../../db/pool.js';
import { errnoOf, isDeadlock } from '../../db/errors.js';
import { withNamedLock } from '../../db/namedLock.js';
import { sleep } from '../../db/tx.js';
import { buildScenario, getScenario, SCENARIOS } from './scenarios.js';
import { emitStepperUpdate } from './emitter.js';
import type {
  ScenarioContext, ScenarioStep, StepResultView, StepperStateView, StepperUpdate, TxnLabel, TxnView,
} from './types.js';

const LOCK_NAME = 'playsync.stepper';
const STEP_TIMEOUT_MS = 300;

class TxnRuntime {
  conn: Connection | null = null;
  connId: number | null = null;
  isolation: TxnView['isolation'] = null;
  steps: ScenarioStep[] = [];
  results: StepResultView[] = [];
  cursor = 0;
  killed = false;
  busy = false;
  ctx: Record<string, unknown> = {};

  constructor(readonly label: TxnLabel) {}
}

class StepperEngine {
  admin: Connection | null = null;
  scenarioId: string | null = null;
  accountIds: number[] = [];
  /** Bumped on every load; a step that settles after a newer load must not write into the new scenario. */
  private generation = 0;
  readonly txns: Record<TxnLabel, TxnRuntime> = { T1: new TxnRuntime('T1'), T2: new TxnRuntime('T2') };

  private connIdToLabel(connId: number): TxnLabel | 'other' {
    for (const t of Object.values(this.txns)) if (t.connId === connId) return t.label;
    return 'other';
  }

  private async ensureConnections(): Promise<void> {
    if (!this.admin) this.admin = await mysql.createConnection(dbConnectionOptions);
    for (const t of Object.values(this.txns)) {
      if (t.conn) continue;
      t.conn = await mysql.createConnection(dbConnectionOptions);
      await t.conn.query('SET SESSION innodb_lock_wait_timeout = 30');
      const [rows] = await t.conn.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
      t.connId = Number(rows[0]!.id);
    }
  }

  private async resetStepperAccounts(): Promise<void> {
    await this.admin!.query(
      `DELETE FROM playback_event WHERE account_id IN (SELECT account_id FROM account WHERE username IN ('step_a','step_b'))`);
    await this.admin!.query(
      `DELETE FROM playback_session WHERE account_id IN (SELECT account_id FROM account WHERE username IN ('step_a','step_b'))`);
    await this.admin!.query(
      `UPDATE account SET max_streams = 1, state_version = 0 WHERE username IN ('step_a','step_b')`);
  }

  private async resolveContext(): Promise<ScenarioContext> {
    const [rows] = await this.admin!.query<RowDataPacket[]>(
      `SELECT a.account_id, a.username, d.device_id
       FROM account a JOIN device d ON d.account_id = a.account_id
       WHERE a.username IN ('step_a', 'step_b') ORDER BY a.username, d.device_id`);
    const byUser = new Map<string, { accountId: number; devices: number[] }>();
    for (const r of rows) {
      const entry: { accountId: number; devices: number[] } =
        byUser.get(r.username) ?? { accountId: r.account_id, devices: [] };
      entry.devices.push(r.device_id);
      byUser.set(r.username, entry);
    }
    const a = byUser.get('step_a');
    const b = byUser.get('step_b');
    if (!a || !b || a.devices.length < 2 || b.devices.length < 2) {
      throw new Error('stepper accounts step_a/step_b are missing or under-seeded; run npm run db:reset');
    }
    const [songRows] = await this.admin!.query<RowDataPacket[]>('SELECT MIN(song_id) AS id FROM song');
    return {
      accountA: a.accountId, accountB: b.accountId,
      deviceA1: a.devices[0]!, deviceA2: a.devices[1]!,
      songId: Number(songRows[0]!.id),
      accountLo: Math.min(a.accountId, b.accountId), accountHi: Math.max(a.accountId, b.accountId),
    };
  }

  /**
   * Ends whatever T1/T2 are in the middle of, so the account reset below can't block on their row
   * locks (which previously made Load hang for up to innodb_lock_wait_timeout while holding the
   * named lock). A transaction with a step still WAITING can't take a ROLLBACK (it would queue
   * behind the blocked statement), so its connection is KILLed and recreated instead.
   */
  private async endOpenTransactions(): Promise<void> {
    for (const t of Object.values(this.txns)) {
      if (!t.conn) continue;
      if (t.busy) {
        await this.admin!.query(`KILL ${t.connId}`).catch(() => undefined); // connId is our own SELECT CONNECTION_ID(), not user input
        await t.conn.end().catch(() => undefined);
        t.conn = null;
        t.connId = null;
      } else {
        await t.conn.query('ROLLBACK').catch(() => undefined);
      }
      t.busy = false;
    }
    await this.ensureConnections();
  }

  /** Loads a scenario: recreates any killed connection, resets step_a/step_b, and resets both transactions. */
  async load(scenarioId: string): Promise<StepperStateView> {
    getScenario(scenarioId); // throws if unknown, before touching anything
    return withNamedLock(LOCK_NAME, 'another stepper session is running', async () => {
      await this.ensureConnections();
      await this.endOpenTransactions();
      this.generation++;
      await this.resetStepperAccounts();
      const ctx = await this.resolveContext();
      const built = buildScenario(scenarioId, ctx);

      for (const label of ['T1', 'T2'] as const) {
        const t = this.txns[label];
        t.steps = built.steps[label];
        t.results = t.steps.map((s, index) => ({ index, display: s.display, status: 'PENDING' }));
        t.cursor = 0;
        t.ctx = {};
        t.killed = false;
        t.isolation = built.isolation[label];
        await t.conn!.query(`SET TRANSACTION ISOLATION LEVEL ${built.isolation[label]}`);
      }
      this.scenarioId = scenarioId;
      this.accountIds = built.accountIds;
      return this.view();
    });
  }

  /** Rolls back both transactions (best-effort) and reloads the current scenario. */
  async reset(): Promise<StepperStateView> {
    if (!this.scenarioId) throw new Error('no scenario loaded');
    return this.load(this.scenarioId); // load() ends any open transaction first
  }

  private async fetchDeadlockText(): Promise<string> {
    try {
      const [rows] = await this.admin!.query<RowDataPacket[]>('SHOW ENGINE INNODB STATUS');
      const statusText = String((rows[0] as { Status?: string } | undefined)?.Status ?? '');
      const marker = 'LATEST DETECTED DEADLOCK';
      const start = statusText.indexOf(marker);
      if (start === -1) return '';
      const afterMarker = statusText.indexOf('\n', start) + 1;
      const sectionEnd = statusText.indexOf('\n------------', afterMarker);
      return sectionEnd === -1 ? statusText.slice(start) : statusText.slice(start, sectionEnd);
    } catch {
      return '';
    }
  }

  private async runStatement(label: TxnLabel, index: number, sql: string, captured: ScenarioStep['capture']): Promise<StepResultView> {
    const t = this.txns[label];
    const gen = this.generation;
    let result: StepResultView;
    try {
      const [raw] = await t.conn!.query(sql);
      const rows = Array.isArray(raw) ? raw : undefined;
      const affectedRows = !Array.isArray(raw) ? (raw as ResultSetHeader).affectedRows : undefined;
      if (captured && rows) Object.assign(t.ctx, captured(rows));
      result = { index, display: t.results[index]!.display, status: 'DONE', resolvedSql: sql, rows, affectedRows };
    } catch (err) {
      const errno = errnoOf(err);
      const deadlockText = isDeadlock(err) ? await this.fetchDeadlockText() : undefined;
      result = {
        index, display: t.results[index]!.display, status: 'ERROR', resolvedSql: sql,
        errno, errorMessage: (err as Error).message, deadlockText,
      };
    }
    if (gen !== this.generation) return result; // a newer scenario was loaded meanwhile; drop this stale outcome
    t.results[index] = result;
    emitStepperUpdate({ txn: label, index, result });
    return result;
  }

  /** Sends the next statement for `label`. Returns immediately with WAITING if it hasn't finished within 300ms. */
  async step(label: TxnLabel): Promise<StepResultView> {
    const t = this.txns[label];
    if (t.killed) throw new Error(`${label} was killed; reset the scenario to continue`);
    // A transaction runs its statements strictly one at a time: while the previous step is still
    // WAITING (its promise hasn't settled), a second call would try to run the next statement on
    // the same connection before the first is done - refuse it instead.
    if (t.busy) throw new Error(`${label} is still waiting on its previous step`);
    if (t.cursor >= t.steps.length) throw new Error(`${label} has no more steps`);
    const index = t.cursor;
    const stepDef = t.steps[index]!;
    const sql = stepDef.sql(t.ctx);
    t.cursor++;
    t.busy = true;
    t.results[index] = { index, display: stepDef.display, status: 'WAITING', resolvedSql: sql };

    const gen = this.generation;
    const settled = this.runStatement(label, index, sql, stepDef.capture).finally(() => { if (gen === this.generation) t.busy = false; });
    const winner = await Promise.race([
      settled.then((r) => ({ tag: 'done' as const, r })),
      sleep(STEP_TIMEOUT_MS).then(() => ({ tag: 'timeout' as const })),
    ]);
    // If it timed out, `settled` keeps running; runStatement() updates state and emits when it settles.
    return winner.tag === 'done' ? winner.r : t.results[index]!;
  }

  /** Kills a transaction's connection. InnoDB rolls it back via the undo log. */
  async kill(label: TxnLabel): Promise<StepperStateView> {
    const t = this.txns[label];
    if (t.killed || t.connId === null) throw new Error(`${label} is not running`);
    const connId = t.connId;
    // connId is a number we read back from our own SELECT CONNECTION_ID(), never user input, so
    // inlining it is safe; KILL does not accept a bound parameter in MySQL's grammar.
    await this.admin!.query(`KILL ${connId}`);
    t.killed = true;
    t.conn = null;
    t.connId = null;
    for (let i = t.cursor; i < t.results.length; i++) {
      t.results[i] = { ...t.results[i]!, status: 'KILLED' };
    }
    emitStepperUpdate({ txn: label, index: -1, result: null, killed: true });
    return this.view();
  }

  view(): StepperStateView {
    const txnView = (t: TxnRuntime): TxnView => ({
      label: t.label, connId: t.connId, isolation: t.isolation, killed: t.killed, busy: t.busy,
      steps: t.results, cursor: t.cursor,
    });
    return { scenarioId: this.scenarioId, accountIds: this.accountIds, txns: { T1: txnView(this.txns.T1), T2: txnView(this.txns.T2) } };
  }

  labelForConnId(connId: number): TxnLabel | 'other' {
    return this.connIdToLabel(connId);
  }

  async closeAll(): Promise<void> {
    for (const t of Object.values(this.txns)) {
      await t.conn?.end().catch(() => undefined);
      t.conn = null;
      t.connId = null;
    }
    await this.admin?.end().catch(() => undefined);
    this.admin = null;
  }
}

export const engine = new StepperEngine();
export const scenarioList = () => SCENARIOS.map((s) => ({
  id: s.id, title: s.title, syllabusRefs: s.syllabusRefs, expected: s.expected,
  explanation: s.explanation, suggestedOrder: s.suggestedOrder,
}));

export type { StepperUpdate };
