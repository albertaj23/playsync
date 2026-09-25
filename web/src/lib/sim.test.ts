import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, initialSim, simReducer, type SimTick } from './sim';

const kpis = { presses: 0, played: 0, rejected: 0, moved: 0, failed: 0, retries: 0, deadlocks: 0, lockTimeouts: 0,
  violatingHouseholds: 0, peakExcess: 0, violationSeconds: 0, newViolationEvents: 0, happinessPct: 100, p50Ms: 0, p95Ms: 0, playsPerSec: 0 };
const tick = (seq: number, over: Partial<SimTick> = {}): SimTick => ({
  seq, phase: 'RUNNING', elapsedMs: seq * 250, config: DEFAULT_CONFIG, kpis, households: [{ active: 0, max: 1 }],
  devices: [], events: [], markers: [], queueDepth: 0, ...over,
});

describe('simReducer', () => {
  it('drops ticks with a lower or equal seq', () => {
    let s = simReducer(initialSim, { type: 'tick', t: tick(1) });
    s = simReducer(s, { type: 'tick', t: tick(5) });
    const stale = simReducer(s, { type: 'tick', t: tick(3, { phase: 'DONE' }) });
    expect(stale).toBe(s);
  });

  it('merges device diffs instead of replacing the whole map', () => {
    let s = simReducer(initialSim, { type: 'tick', t: tick(1, { devices: [{ h: 0, d: 0, state: 'IDLE' }, { h: 0, d: 1, state: 'IDLE' }] }) });
    s = simReducer(s, { type: 'tick', t: tick(2, { devices: [{ h: 0, d: 1, state: 'PLAYING', song: 'X' }] }) });
    expect(s.devices['0:0']!.state).toBe('IDLE');
    expect(s.devices['0:1']!.state).toBe('PLAYING');
  });

  it('batches events without duplicates and caps at 200', () => {
    const ev = (id: number) => ({ id, tMs: id, kind: 'reject', message: 'm', tech: {} });
    let s = simReducer(initialSim, { type: 'tick', t: tick(1, { events: [ev(1), ev(2)] }) });
    s = simReducer(s, { type: 'tick', t: tick(2, { events: [ev(2), ev(3)] }) });
    expect(s.events.map((e) => e.id)).toEqual([1, 2, 3]);
    s = simReducer(s, { type: 'tick', t: tick(3, { events: Array.from({ length: 250 }, (_, i) => ev(10 + i)) }) });
    expect(s.events).toHaveLength(200);
  });

  it('a fresh run (seq 1) starts clean even after a longer earlier run', () => {
    let s = simReducer(initialSim, { type: 'tick', t: tick(40) });
    s = simReducer(s, { type: 'tick', t: tick(1, { devices: [{ h: 0, d: 0, state: 'IDLE' }] }) });
    expect(s.seq).toBe(1);
    expect(Object.keys(s.devices)).toEqual(['0:0']);
  });
});
