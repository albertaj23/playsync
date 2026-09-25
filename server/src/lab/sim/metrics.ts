import { percentile } from '../stats.js';
import type { Kpis, SeriesPoint } from './types.js';

interface Sample { t: number; ms: number; happy: boolean }

/** Run-wide counters plus press samples for windowed percentiles. */
export class Metrics {
  presses = 0; played = 0; rejected = 0; moved = 0; failed = 0;
  retries = 0; deadlocks = 0; lockTimeouts = 0;
  peakExcess = 0; violationSeconds = 0; newViolationEvents = 0; violatingHouseholds = 0;
  private samples: Sample[] = [];
  private playedTimes: number[] = [];
  series: SeriesPoint[] = [];

  /** One finished press. Correct rejections within 1 s count as happy: honest, fast feedback. */
  recordPress(t: number, outcome: 'PLAYING' | 'REJECTED' | 'FAILED', totalMs: number) {
    this.presses++;
    if (outcome === 'PLAYING') { this.played++; this.playedTimes.push(t); }
    else if (outcome === 'REJECTED') this.rejected++;
    else this.failed++;
    this.samples.push({ t, ms: totalMs, happy: outcome === 'PLAYING' || (outcome === 'REJECTED' && totalMs <= 1000) });
  }

  private window(nowMs: number, spanMs: number): Sample[] {
    const out: Sample[] = [];
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i]!.t >= nowMs - spanMs; i--) out.push(this.samples[i]!);
    return out;
  }

  playsPerSec(nowMs: number): number {
    let n = 0;
    for (let i = this.playedTimes.length - 1; i >= 0 && this.playedTimes[i]! >= nowMs - 5000; i--) n++;
    return Math.round((n / 5) * 10) / 10;
  }

  kpis(nowMs: number, allTime = false): Kpis {
    const s = allTime ? this.samples : this.window(nowMs, 10_000);
    const ms = s.map((x) => x.ms).sort((a, b) => a - b);
    const all = allTime ? ms : this.samples.map((x) => x.ms).sort((a, b) => a - b);
    const happy = s.length ? Math.round((s.filter((x) => x.happy).length / s.length) * 100) : 100;
    return {
      presses: this.presses, played: this.played, rejected: this.rejected, moved: this.moved, failed: this.failed,
      retries: this.retries, deadlocks: this.deadlocks, lockTimeouts: this.lockTimeouts,
      violatingHouseholds: this.violatingHouseholds, peakExcess: this.peakExcess,
      violationSeconds: Math.round(this.violationSeconds * 10) / 10, newViolationEvents: this.newViolationEvents,
      happinessPct: happy,
      p50Ms: Math.round(percentile(all, 50)), p95Ms: Math.round(percentile(allTime ? all : ms, 95)),
      playsPerSec: this.playsPerSec(nowMs),
    };
  }

  /** At most `max` points, evenly sampled, for persistence. */
  downsampledSeries(max = 180): SeriesPoint[] {
    if (this.series.length <= max) return this.series;
    const step = this.series.length / max;
    return Array.from({ length: max }, (_, i) => this.series[Math.floor(i * step)]!);
  }
}
