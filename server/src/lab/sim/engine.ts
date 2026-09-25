// Simulation engine: a crowd of virtual devices making REAL claims through the real strategies.
// Singleton, like the stepper engine. One run at a time, guarded by the lab named lock, which is
// held for the whole run (start() returns as soon as the lock is acquired and setup is done).

import type { RowDataPacket } from 'mysql2/promise';
import { appPool, labPool } from '../../db/pool.js';
import { flushSlots, redisInUse } from '../../db/redis.js';
import { newStats } from '../../db/tx.js';
import { prepareForStrategy } from '../../strategies/artifacts.js';
import { executeClaim, strategies, type ClaimResult, type StrategyName } from '../../strategies/index.js';
import { FaultInjectedError } from '../../strategies/types.js';
import { getLiveStrategy, heartbeat, release, ServiceError, SessionLostError } from '../../services/playback.js';
import { reapAccount } from '../../services/leaseReaper.js';
import { withLabLock } from '../labLock.js';
import { saveRun } from '../persist.js';
import { assertStrategyFits, FRIENDLY_STRATEGY, parseConfig, parseLivePatch } from './config.js';
import { newDevice, rand, sleepMs, type VDevice } from './device.js';
import { simEmit } from './emitter.js';
import { Metrics } from './metrics.js';
import { buildNames } from './names.js';
import { readTruth, repairAccount, type AccountTruth } from './truth.js';
import type {
  DeviceDiff, HouseholdInfo, SimConfig, SimEvent, SimPhase, SimSnapshot, SimSummary, SimTick,
} from './types.js';

const LOOP_MS = 100;
const TICK_MS = 250;
const TRUTH_MS = 500;
const COOL_MS = 1500;
const WAVE_MS = 6000;
const MAX_HEARTBEATS_IN_FLIGHT = 16;

const diffOf = (v: VDevice): DeviceDiff => ({ h: v.h, d: v.d, state: v.state, song: v.song, retries: v.retries || undefined });
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

class SimEngine {
  phase: SimPhase = 'IDLE';
  cfg!: SimConfig;
  private names: HouseholdInfo[] = [];
  private devices: VDevice[][] = [];
  private bySession = new Map<number, VDevice>();
  private songs: { id: number; title: string }[] = [];
  private originals: { accountId: number; maxStreams: number }[] = [];
  private accountIds: number[] = [];
  private metrics = new Metrics();
  private truth: AccountTruth[] = [];
  private over: boolean[] = [];
  private events: SimEvent[] = [];
  private pendingEvents: SimEvent[] = [];
  private nextEventId = 1;
  private markers: { tMs: number; label: string }[] = [];
  private dirty = new Set<VDevice>();
  private seq = 0;
  private t0 = 0;
  private stopRequested = false;
  private paused = false;
  private inFlight = 0;
  private heartbeatsInFlight = 0;
  private nextWaveAt = 0;
  private nextArrivalAt: number[] = [];
  private lastSecond = 0;
  private lastTruthAt = 0;
  private lastTickAt = 0;
  private lastLoopAt = 0;
  private lastSweepAt = 0;
  private sweeping = false;
  private summary: SimSummary | null = null;
  private runPromise: Promise<void> | null = null;

  private elapsed = () => Date.now() - this.t0;

  private emitEvent(kind: SimEvent['kind'], message: string, tech: Record<string, unknown> = {}) {
    const e: SimEvent = { id: this.nextEventId++, tMs: this.elapsed(), kind, message, tech };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.pendingEvents.push(e);
  }

  private setState(v: VDevice, state: VDevice['state']) {
    v.state = state;
    if (state === 'REJECTED' || state === 'FAILED' || state === 'MOVED') v.coolUntil = Date.now() + COOL_MS;
    if (state === 'IDLE') { v.song = undefined; v.offline = false; v.retries = 0; }
    this.dirty.add(v);
  }

  private who(v: VDevice) { return this.names[v.h]!.devices[v.d]!.name; }
  private household(v: VDevice) { return this.names[v.h]!.name; }

  // ------------------------------------------------------------------ lifecycle

  async start(raw: unknown): Promise<SimSnapshot> {
    if (this.phase !== 'IDLE' && this.phase !== 'DONE') throw new ServiceError(409, 'BUSY', 'a simulation is already running');
    const cfg = parseConfig(raw);
    this.phase = 'STARTING';
    let resolveStarted!: () => void;
    let rejectStarted!: (e: unknown) => void;
    const started = new Promise<void>((res, rej) => { resolveStarted = res; rejectStarted = rej; });
    let settled = false;
    this.runPromise = withLabLock(async () => {
      try {
        await this.setup(cfg);
        settled = true;
        resolveStarted();
        await this.runLoop();
      } catch (err) {
        if (!settled) { settled = true; rejectStarted(err); } else console.error('simulation failed', err);
      } finally {
        await this.teardown().catch((e) => console.error('simulation teardown failed', e));
      }
    }).catch((err) => { if (!settled) { settled = true; rejectStarted(err); } });
    try {
      await started;
    } catch (err) {
      this.phase = 'IDLE';
      throw err;
    }
    return this.snapshot();
  }

  private async setup(cfg: SimConfig): Promise<void> {
    this.cfg = cfg;
    this.metrics = new Metrics();
    this.events = []; this.pendingEvents = []; this.nextEventId = 1; this.markers = [];
    this.dirty.clear(); this.bySession.clear(); this.summary = null;
    this.stopRequested = false; this.paused = false; this.inFlight = 0; this.heartbeatsInFlight = 0; this.seq = 0;

    const [rows] = await appPool.query<RowDataPacket[]>(
      `SELECT a.account_id, a.max_streams, d.device_id FROM account a JOIN device d ON d.account_id = a.account_id
       WHERE a.is_lab = TRUE ORDER BY a.account_id, d.device_id`);
    const byAccount = new Map<number, { max: number; devs: number[] }>();
    for (const r of rows) {
      const e: { max: number; devs: number[] } = byAccount.get(r.account_id) ?? { max: r.max_streams, devs: [] };
      e.devs.push(r.device_id);
      byAccount.set(r.account_id, e);
    }
    const chosen = [...byAccount.entries()].slice(0, cfg.accounts);
    if (chosen.length < cfg.accounts || chosen.some(([, e]) => e.devs.length < cfg.devicesPerAccount)) {
      throw new ServiceError(400, 'BAD_PARAMS', 'not enough lab accounts/devices seeded for this configuration');
    }
    this.accountIds = chosen.map(([id]) => id);
    this.originals = chosen.map(([id, e]) => ({ accountId: id, maxStreams: e.max }));
    const topo = chosen.map(([accountId, e]) => ({ accountId, deviceIds: e.devs.slice(0, cfg.devicesPerAccount) }));
    this.names = buildNames(topo);
    this.devices = topo.map((t, h) => t.deviceIds.map((deviceId, d) => newDevice(h, d, t.accountId, deviceId)));
    this.over = topo.map(() => false);
    this.nextArrivalAt = topo.map(() => 0);

    const [songRows] = await appPool.query<RowDataPacket[]>('SELECT song_id, title FROM song ORDER BY song_id LIMIT 24');
    this.songs = songRows.map((s) => ({ id: s.song_id, title: s.title }));

    const conn = await appPool.getConnection();
    try {
      await conn.query('DELETE FROM playback_event WHERE account_id IN (?)', [this.accountIds]);
      await conn.query('DELETE FROM playback_session WHERE account_id IN (?)', [this.accountIds]);
      await conn.query('UPDATE account SET max_streams = ?, state_version = 0 WHERE account_id IN (?)', [cfg.maxStreams, this.accountIds]);
      await prepareForStrategy(conn, cfg.strategy);
    } finally {
      conn.release();
    }
    if (cfg.strategy === 'REDIS_LEASE') await flushSlots();
    this.truth = this.accountIds.map((accountId) => ({ accountId, max: cfg.maxStreams, active: 0 }));
    this.t0 = Date.now();
    this.nextWaveAt = 500;
    this.lastSecond = 0; this.lastTruthAt = 0; this.lastTickAt = 0; this.lastLoopAt = this.t0; this.lastSweepAt = this.t0;
    this.markers.push({ tMs: 0, label: `Protection: ${FRIENDLY_STRATEGY[cfg.strategy]}` });
    this.phase = 'RUNNING';
    this.emitTick(true);
  }

  private async runLoop(): Promise<void> {
    while (!this.stopRequested && this.elapsed() < this.cfg.durationSec * 1000) {
      await sleepMs(LOOP_MS);
      const now = Date.now();
      const dt = now - this.lastLoopAt;
      this.lastLoopAt = now;
      this.stepDevices(now);
      if (!this.paused) this.schedule(now, dt);
      if (now - this.lastSweepAt >= 1000) { this.lastSweepAt = now; void this.sweep(); }
      if (now - this.lastTruthAt >= TRUTH_MS) { const gap = this.lastTruthAt ? now - this.lastTruthAt : TRUTH_MS; this.lastTruthAt = now; await this.refreshTruth(gap); }
      if (now - this.lastTickAt >= TICK_MS) { this.lastTickAt = now; this.emitTick(false); }
    }
  }

  private async teardown(): Promise<void> {
    this.phase = 'STOPPING';
    this.emitTick(true);
    const deadline = Date.now() + 8000;
    while (this.inFlight > 0 && Date.now() < deadline) await sleepMs(50);
    await this.refreshTruth(TRUTH_MS).catch(() => undefined);
    const wallMs = this.elapsed();
    const kpis = this.metrics.kpis(wallMs, true);
    // Everything the simulation started is ended, limits and the index are restored.
    await appPool.query(
      `UPDATE playback_session SET status = 'ENDED', ended_at = NOW(3) WHERE account_id IN (?) AND status IN ('PLAYING', 'PAUSED')`,
      [this.accountIds]);
    for (const o of this.originals) await appPool.query('UPDATE account SET max_streams = ? WHERE account_id = ?', [o.maxStreams, o.accountId]);
    const conn = await appPool.getConnection();
    try { await prepareForStrategy(conn, getLiveStrategy()); } finally { conn.release(); }
    if (redisInUse()) await flushSlots().catch(() => undefined);

    const batchId = crypto.randomUUID();
    const cfg = this.cfg;
    const summary: SimSummary = {
      batchId, config: cfg, kpis, verdict: this.metrics.newViolationEvents > 0 ? 'BROKEN' : 'HELD',
      markers: this.markers, series: this.metrics.downsampledSeries(), wallMs,
    };
    try {
      await saveRun({
        experiment: 'STREAM_LIMIT', strategy: cfg.strategy, isolationLevel: strategies[cfg.strategy].defaultIsolation === 'AUTOCOMMIT' ? 'AUTOCOMMIT' : (cfg.strategy === 'TXN_RR' ? cfg.isolation : strategies[cfg.strategy].defaultIsolation),
        mode: cfg.policy === 'TAKEOVER' ? 'TAKEOVER' : 'NORMAL', concurrency: cfg.accounts * cfg.devicesPerAccount,
        accounts: cfg.accounts, maxStreams: cfg.maxStreams, raceDelayMs: cfg.checkDelayMs,
        granted: kpis.played, rejected: kpis.rejected, retries: kpis.retries, deadlocks: kpis.deadlocks,
        lockTimeouts: kpis.lockTimeouts, errors: kpis.failed, violations: kpis.peakExcess,
        p50Ms: kpis.p50Ms, p95Ms: kpis.p95Ms, throughputRps: Math.round((kpis.presses / Math.max(1, wallMs / 1000)) * 100) / 100,
        wallMs, batchId, trial: 1, source: 'SIM', detail: summary,
      });
    } catch (err) {
      console.error('could not persist simulation run', err);
      summary.batchId = null;
    }
    this.summary = summary;
    this.phase = 'DONE';
    simEmit().done(summary);
    this.emitTick(true);
  }

  async stop(): Promise<SimSnapshot> {
    if (this.phase === 'IDLE' || this.phase === 'DONE') return this.snapshot();
    this.stopRequested = true;
    await this.runPromise;
    return this.snapshot();
  }

  pause() { if (this.phase === 'RUNNING') { this.paused = true; this.phase = 'PAUSED'; } return this.snapshot(); }
  resume() { if (this.phase === 'PAUSED') { this.paused = false; this.phase = 'RUNNING'; } return this.snapshot(); }
  closeAll() { return this.stop(); }

  // ------------------------------------------------------------------ live changes

  async patch(raw: unknown): Promise<SimSnapshot> {
    if (this.phase !== 'RUNNING' && this.phase !== 'PAUSED') throw new ServiceError(409, 'NOT_RUNNING', 'no simulation is running');
    const patch = parseLivePatch(raw);
    if (patch.strategy && patch.strategy !== this.cfg.strategy) {
      assertStrategyFits(patch.strategy, this.cfg.maxStreams);
      const conn = await appPool.getConnection();
      try { await prepareForStrategy(conn, patch.strategy); } finally { conn.release(); }
      this.markers.push({ tMs: this.elapsed(), label: `Protection → ${FRIENDLY_STRATEGY[patch.strategy]}` });
      this.emitEvent('switch', `Protection switched to "${FRIENDLY_STRATEGY[patch.strategy]}"`, { from: this.cfg.strategy, to: patch.strategy });
    }
    if (patch.ratePerSec !== undefined) this.nextArrivalAt = this.nextArrivalAt.map(() => 0);
    this.cfg = { ...this.cfg, ...patch };
    return this.snapshot();
  }

  async repair(): Promise<{ repaired: number; households: number }> {
    if (this.phase !== 'RUNNING' && this.phase !== 'PAUSED') throw new ServiceError(409, 'NOT_RUNNING', 'no simulation is running');
    let repaired = 0, households = 0;
    for (let h = 0; h < this.accountIds.length; h++) {
      const r = await repairAccount(this.accountIds[h]!);
      if (!r) continue;
      households++;
      repaired += r.ended.length;
      for (const e of r.ended) {
        const v = this.bySession.get(e.sessionId);
        if (v) { this.bySession.delete(e.sessionId); v.sessionId = null; this.setState(v, 'IDLE'); }
      }
      this.emitEvent('repair', `Repaired ${this.names[h]!.name}: ${r.ended.length} extra screen${r.ended.length === 1 ? '' : 's'} switched off`,
        { accountId: r.accountId, sessionIds: r.ended.map((x) => x.sessionId) });
    }
    await this.refreshTruth(TRUTH_MS);
    return { repaired, households };
  }

  // ------------------------------------------------------------------ arrivals

  private idleDevices(h: number) { return this.devices[h]!.filter((v) => v.state === 'IDLE'); }

  private schedule(now: number, _dt: number) {
    const el = this.elapsed();
    if (this.cfg.arrival === 'BURST') {
      if (el < this.nextWaveAt) return;
      this.nextWaveAt = el + WAVE_MS;
      for (let h = 0; h < this.devices.length; h++) for (const v of this.idleDevices(h)) void this.press(v);
      return;
    }
    const ramp = this.cfg.arrival === 'RUSH' ? 0.1 + 0.9 * Math.min(1, el / (this.cfg.durationSec * 1000)) : 1;
    const rate = this.cfg.ratePerSec * ramp;
    for (let h = 0; h < this.devices.length; h++) {
      if (this.nextArrivalAt[h]! === 0) this.nextArrivalAt[h] = now + (-Math.log(1 - Math.random()) / rate) * 1000;
      if (now < this.nextArrivalAt[h]!) continue;
      const idle = this.idleDevices(h);
      if (idle.length) void this.press(idle[Math.floor(Math.random() * idle.length)]!);
      this.nextArrivalAt[h] = now + (-Math.log(1 - Math.random()) / rate) * 1000;
    }
  }

  // ------------------------------------------------------------------ one press = one real claim

  private async press(v: VDevice): Promise<void> {
    if (v.state !== 'IDLE') return;
    this.setState(v, 'PRESSING');
    this.inFlight++;
    const start = Date.now();
    const song = this.songs[Math.floor(Math.random() * this.songs.length)]!;
    const strategyName: StrategyName = this.cfg.strategy;
    const stats = newStats();
    let outcome: 'PLAYING' | 'REJECTED' | 'FAILED' = 'FAILED';
    try {
      await sleepMs(rand(0, this.cfg.jitterMs));
      let result: ClaimResult | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const takeover = this.cfg.policy === 'TAKEOVER' || attempt === 1;
        const crash = Math.random() * 100 < this.cfg.crashPct;
        const conn = await labPool.getConnection();
        try {
          result = await executeClaim(strategies[strategyName], conn, {
            accountId: v.accountId, deviceId: v.deviceId, songId: song.id, mode: takeover ? 'TAKEOVER' : 'NORMAL',
            raceDelayMs: this.cfg.checkDelayMs, isolation: strategyName === 'TXN_RR' ? this.cfg.isolation : undefined, leaseMs: this.cfg.leaseSec * 1000,
            fault: crash ? 'AFTER_SESSION_INSERT' : undefined,
          }, stats);
        } finally {
          conn.release();
        }
        const askedYes = this.cfg.policy === 'ASK' && result.outcome === 'REJECTED' && attempt === 0 && Math.random() * 100 < this.cfg.askYesPct;
        if (!askedYes) break;
      }
      await sleepMs(rand(0, this.cfg.jitterMs));
      if (result?.outcome === 'GRANTED') {
        outcome = 'PLAYING';
        this.onGranted(v, result, song.title);
      } else {
        outcome = 'REJECTED';
        this.setState(v, 'REJECTED');
        this.emitEvent('reject', `${this.who(v)}: ${this.cfg.maxStreams} screen${this.cfg.maxStreams === 1 ? ' is' : 's are'} already playing in ${this.household(v)}`,
          { deviceId: v.deviceId, accountId: v.accountId, strategy: strategyName });
      }
    } catch (err) {
      outcome = 'FAILED';
      this.setState(v, 'FAILED');
      if (err instanceof FaultInjectedError) {
        this.emitEvent('crash', `Something went wrong starting the song on ${this.who(v)}: nothing was charged to ${this.household(v)}`,
          { deviceId: v.deviceId, fault: 'AFTER_SESSION_INSERT', rolledBack: strategyName !== 'NAIVE' });
      } else {
        this.emitEvent('fail', `${this.who(v)} gave up after too many tries`, { deviceId: v.deviceId, error: errMessage(err) });
      }
    } finally {
      this.metrics.retries += stats.retries; this.metrics.deadlocks += stats.deadlocks; this.metrics.lockTimeouts += stats.lockTimeouts;
      v.retries = stats.retries;
      this.metrics.recordPress(this.elapsed(), outcome, Date.now() - start);
      this.inFlight--;
    }
  }

  private onGranted(v: VDevice, r: Extract<ClaimResult, { outcome: 'GRANTED' }>, title: string) {
    const now = Date.now();
    v.sessionId = r.sessionId;
    v.song = title;
    v.listenEndsAt = now + rand(this.cfg.listenMinSec, this.cfg.listenMaxSec) * 1000;
    v.nextHeartbeatAt = now + (this.cfg.leaseSec * 1000) / 3;
    this.bySession.set(r.sessionId, v);
    const goesOffline = Math.random() * 100 < this.cfg.offlinePct;
    v.offline = goesOffline;
    this.setState(v, goesOffline ? 'OFFLINE' : 'PLAYING');
    if (goesOffline) this.emitEvent('offline', `${this.who(v)} went to sleep; its spot opens up in a few seconds`, { deviceId: v.deviceId });
    for (const sid of r.preempted) {
      const victim = this.bySession.get(sid);
      if (!victim) continue;
      this.bySession.delete(sid);
      victim.sessionId = null;
      this.metrics.moved++;
      this.setState(victim, 'MOVED');
      this.emitEvent('move', `Playback moved from ${this.who(victim)} to ${this.who(v)}`, { fromDevice: victim.deviceId, toDevice: v.deviceId });
    }
  }

  // ------------------------------------------------------------------ device upkeep

  private stepDevices(now: number) {
    for (const row of this.devices) for (const v of row) {
      if ((v.state === 'REJECTED' || v.state === 'FAILED' || v.state === 'MOVED') && now >= v.coolUntil) this.setState(v, 'IDLE');
      if (v.state === 'PLAYING' && !v.busy) {
        if (now >= v.listenEndsAt) void this.finish(v);
        else if (now >= v.nextHeartbeatAt && this.heartbeatsInFlight < MAX_HEARTBEATS_IN_FLIGHT) void this.beat(v);
      }
      if (v.state === 'OFFLINE' && now >= v.listenEndsAt + this.cfg.leaseSec * 1000 * 2 && !v.sessionId) this.setState(v, 'IDLE');
    }
  }

  private async beat(v: VDevice) {
    if (v.sessionId === null) return;
    v.busy = true; this.heartbeatsInFlight++;
    try {
      await heartbeat(v.sessionId, v.deviceId, 0, this.cfg.leaseSec * 1000);
      v.nextHeartbeatAt = Date.now() + (this.cfg.leaseSec * 1000) / 3;
    } catch (err) {
      if (err instanceof SessionLostError) this.lost(v, err.reason);
    } finally {
      v.busy = false; this.heartbeatsInFlight--;
    }
  }

  private async finish(v: VDevice) {
    if (v.sessionId === null) return;
    v.busy = true;
    const sid = v.sessionId;
    try {
      await release(sid, v.deviceId);
      this.bySession.delete(sid); v.sessionId = null; this.setState(v, 'IDLE');
    } catch (err) {
      if (err instanceof SessionLostError) this.lost(v, err.reason);
    } finally {
      v.busy = false;
    }
  }

  private lost(v: VDevice, reason: string) {
    if (v.sessionId !== null) this.bySession.delete(v.sessionId);
    v.sessionId = null;
    if (reason === 'PREEMPTED') { this.metrics.moved++; this.setState(v, 'MOVED'); }
    else this.setState(v, 'IDLE');
  }

  /** The simulation's own expire sweep: the global reaper skips lab accounts on purpose. */
  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const accountId of this.accountIds) {
        const r = await reapAccount(accountId);
        for (const e of r?.expired ?? []) {
          const v = this.bySession.get(e.sessionId);
          if (!v) continue;
          this.bySession.delete(e.sessionId);
          v.sessionId = null;
          this.emitEvent('expired', `${this.who(v)}'s spot opened up again`, { sessionId: e.sessionId });
          this.setState(v, 'IDLE');
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  // ------------------------------------------------------------------ ground truth and ticks

  private async refreshTruth(dtMs: number) {
    const truth = await readTruth(this.accountIds);
    this.truth = truth;
    let violating = 0;
    truth.forEach((t, h) => {
      const isOver = t.active > t.max;
      if (isOver) {
        violating++;
        this.metrics.peakExcess = Math.max(this.metrics.peakExcess, t.active - t.max);
      }
      if (isOver && !this.over[h]) {
        this.metrics.newViolationEvents++;
        this.emitEvent('violation', `${this.names[h]!.name} has ${t.active} screens playing but only ${t.max} ${t.max === 1 ? 'is' : 'are'} allowed`,
          { accountId: t.accountId, active: t.active, max: t.max, strategy: this.cfg.strategy });
      } else if (!isOver && this.over[h]) {
        this.emitEvent('cleared', `${this.names[h]!.name} is back within its limit`, { accountId: t.accountId });
      }
      this.over[h] = isOver;
    });
    this.metrics.violatingHouseholds = violating;
    this.metrics.violationSeconds += (violating * dtMs) / 1000;
  }

  private buildTick(full: boolean): SimTick {
    const el = this.elapsed();
    const kpis = this.metrics.kpis(el);
    let series: SimTick['series'];
    const sec = Math.floor(el / 1000);
    if (sec > this.lastSecond) {
      this.lastSecond = sec;
      series = { t: sec, playsPerSec: kpis.playsPerSec, p95Ms: kpis.p95Ms, violating: kpis.violatingHouseholds, happiness: kpis.happinessPct };
      this.metrics.series.push(series);
    }
    const devices = full
      ? this.devices.flat().map(diffOf)
      : [...this.dirty].map(diffOf);
    this.dirty.clear();
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return {
      seq: ++this.seq, phase: this.phase, elapsedMs: el, config: this.cfg, kpis,
      households: this.truth.map((t) => ({ active: t.active, max: t.max })),
      devices, events, series, markers: this.markers, queueDepth: this.inFlight,
    };
  }

  private emitTick(full: boolean) {
    if (!this.cfg) return;
    simEmit().tick(this.buildTick(full));
  }

  snapshot(): SimSnapshot {
    if (!this.cfg) {
      return { seq: 0, phase: this.phase, elapsedMs: 0, config: parseConfig({}), kpis: this.metrics.kpis(0), households: [], devices: [],
        events: [], markers: [], queueDepth: 0, seriesAll: [], names: [], allDevices: [], summary: null };
    }
    const el = this.phase === 'DONE' && this.summary ? this.summary.wallMs : this.elapsed();
    return {
      seq: this.seq, phase: this.phase, elapsedMs: el, config: this.cfg, kpis: this.metrics.kpis(el, this.phase === 'DONE'),
      households: this.truth.map((t) => ({ active: t.active, max: t.max })), devices: [], events: [...this.events],
      series: undefined, markers: this.markers, queueDepth: 0,
      seriesAll: this.metrics.series, names: this.names, allDevices: this.devices.flat().map(diffOf), summary: this.summary,
    };
  }

  seriesSoFar() { return this.metrics.series; }
}

export const simEngine = new SimEngine();
