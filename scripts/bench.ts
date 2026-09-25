#!/usr/bin/env -S npx tsx
// CLI experiment matrix (PLAN.md §8.5). Run from the repo root:
//   npm run bench                    full matrix (~1200 trials, several minutes)
//   npm run bench -- --quick         a fast smoke test
//   npm run bench -- --trials 5      override the trial count
//   npm run bench -- --only stream   just the stream-limit matrix (or --only lost)
//   npm run bench -- --no-md         skip updating docs/experiments.md
//   npm run bench -- --stretch       also run the Phase 7 strategies (TRIGGER, REDIS_LEASE)
//
// Runs entirely in-process against the server's lab modules (no HTTP, no running server needed
// beyond MySQL itself). One batchId tags every row this invocation writes to experiment_run
// (source = 'BENCH'). Writes CSVs to docs/results/ and replaces the generated tables in
// docs/experiments.md between the <!-- bench:start --> / <!-- bench:end --> markers.
//
// config.ts resolves ../../.env relative to ITS OWN file location, so it finds the repo root's
// .env regardless of the working directory this script is run from.

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../server/src/config.js';
import { closePools } from '../server/src/db/pool.js';
import { LabBusyError } from '../server/src/lab/labLock.js';
import { runLostUpdateExperiment, type LostUpdateResult, type LostUpdateVariant } from '../server/src/lab/lostUpdate.js';
import { runStreamLimitExperiment, type RaceResult } from '../server/src/lab/raceRunner.js';
import { closeRedis } from '../server/src/db/redis.js';
import { mean, median, round2 } from '../server/src/lab/stats.js';
import type { Isolation } from '../server/src/db/tx.js';
import type { StrategyName } from '../server/src/strategies/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_DIR = path.join(ROOT, 'docs', 'results');
const EXPERIMENTS_MD = path.join(ROOT, 'docs', 'experiments.md');

// -------------------------------------------------------------- args

interface Args { quick: boolean; trials?: number; only?: 'stream' | 'lost'; noMd: boolean; stretch: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { quick: false, noMd: false, stretch: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quick') a.quick = true;
    else if (arg === '--trials') a.trials = Number(argv[++i]);
    else if (arg === '--only') a.only = argv[++i] as 'stream' | 'lost';
    else if (arg === '--no-md') a.noMd = true;
    else if (arg === '--stretch') a.stretch = true;
    else console.warn(`bench: ignoring unknown argument "${arg}"`);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

// -------------------------------------------------------------- matrix

interface StreamCell { strategy: StrategyName; isolation?: Isolation; label: string }

const STREAM_CELLS: StreamCell[] = [
  { strategy: 'NAIVE', label: 'NAIVE' },
  { strategy: 'TXN_RR', isolation: 'REPEATABLE READ', label: 'TXN_RR@RR' },
  { strategy: 'TXN_RR', isolation: 'READ COMMITTED', label: 'TXN_RR@RC' },
  { strategy: 'SERIALIZABLE', label: 'SERIALIZABLE' },
  { strategy: 'PESSIMISTIC', label: 'PESSIMISTIC' },
  { strategy: 'OPTIMISTIC', label: 'OPTIMISTIC' },
  { strategy: 'CONSTRAINT', label: 'CONSTRAINT' },
  // Phase 7 stretch strategies (need Redis for REDIS_LEASE): included with --stretch
  ...(args.stretch ? [
    { strategy: 'TRIGGER' as const, label: 'TRIGGER' },
    { strategy: 'REDIS_LEASE' as const, label: 'REDIS_LEASE' },
  ] : []),
];

const concurrencies = args.quick ? [2, 32] : [2, 8, 32, 64];
const accountsList = [1, 16];
const delays = args.quick ? [20] : [0, 20];
const streamTrials = args.trials ?? (args.quick ? 2 : 10);

const LU_VARIANTS: LostUpdateVariant[] = ['NAIVE_RMW', 'ATOMIC', 'LOCKED', 'CAS'];
const luIncrements = args.quick ? [50] : [10, 50];
const luDelays = args.quick ? [20] : [0, 20];
const luTrials = args.trials ?? (args.quick ? 2 : 5);

const runStream = args.only !== 'lost';
const runLost = args.only !== 'stream';

const streamCellCount = STREAM_CELLS.length * concurrencies.length * accountsList.length * delays.length;
const streamTotal = runStream ? streamCellCount * streamTrials : 0;
const lostCellCount = LU_VARIANTS.length * luIncrements.length * luDelays.length;
const lostTotal = runLost ? lostCellCount * luTrials : 0;
const grandTotal = streamTotal + lostTotal;

// -------------------------------------------------------------- progress

let done = 0;
const startedAt = Date.now();

function printProgress(line: string) {
  done++;
  let suffix = '';
  if (done >= 20) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = (elapsedMs / done) * (grandTotal - done);
    suffix = ` (~${Math.round(remainingMs / 1000)}s remaining)`;
  }
  console.log(`[${done}/${grandTotal}] ${line}${suffix}`);
}

// -------------------------------------------------------------- CSV

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// -------------------------------------------------------------- main

interface StreamRow extends RaceResult { label: string; runId: number; trial: number; batchId: string }
interface LostRow extends LostUpdateResult { runId: number; trial: number; batchId: string }

async function main() {
  console.log(`playsync bench: ${grandTotal} trials planned (stream ${streamTotal}, lost-update ${lostTotal})`);
  if (config.DEFAULT_STRATEGY === 'CONSTRAINT') {
    console.log(
      `NOTE: the server's DEFAULT_STRATEGY is CONSTRAINT. This bench restores the unique index for ` +
      `DEFAULT_STRATEGY when it finishes, so the live app's strategy setting is unaffected - but if you ` +
      `manually switched the LIVE strategy (via the UI) to something else, re-select it after this bench runs.`,
    );
  }

  const batchId = randomUUID();
  const streamRows: StreamRow[] = [];
  const lostRows: LostRow[] = [];

  try {
    if (runStream) {
      for (const cell of STREAM_CELLS) {
        for (const concurrency of concurrencies) {
          for (const accounts of accountsList) {
            for (const raceDelayMs of delays) {
              const { trials } = await runStreamLimitExperiment(
                {
                  strategy: cell.strategy, isolation: cell.isolation, concurrency, accounts, maxStreams: 1,
                  raceDelayMs, mode: 'NORMAL', trials: streamTrials, batchId, source: 'BENCH',
                },
                config.DEFAULT_STRATEGY,
              );
              for (const t of trials) {
                printProgress(
                  `${cell.label} c=${concurrency} a=${accounts} d=${raceDelayMs} trial ${t.trial} ` +
                  `→ viol ${t.violations}, retries ${t.retries}, p95 ${t.p95Ms} ms`,
                );
                streamRows.push({ ...t, label: cell.label });
              }
            }
          }
        }
      }
    }

    if (runLost) {
      for (const variant of LU_VARIANTS) {
        for (const increments of luIncrements) {
          for (const raceDelayMs of luDelays) {
            const { trials } = await runLostUpdateExperiment({
              variant, increments, raceDelayMs, trials: luTrials, batchId, source: 'BENCH',
            });
            for (const t of trials) {
              printProgress(`lost-update ${variant} n=${increments} d=${raceDelayMs} trial ${t.trial} → final ${t.finalCount}, lost ${t.lost}, p95 ${t.p95Ms} ms`);
              lostRows.push(t);
            }
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof LabBusyError) {
      console.error('bench: another experiment is running; stop the UI experiment or the tests and retry.');
      await closeRedis();
  await closePools();
      process.exit(2);
    }
    throw err;
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = timestamp();
  let streamCsvPath: string | null = null;
  let lostCsvPath: string | null = null;

  if (streamRows.length > 0) {
    streamCsvPath = path.join(RESULTS_DIR, `stream-limit-${ts}.csv`);
    fs.writeFileSync(streamCsvPath, toCsv(streamRows.map(streamCsvRow)));
    console.log(`wrote ${path.relative(ROOT, streamCsvPath)} (${streamRows.length} rows)`);
  }
  if (lostRows.length > 0) {
    lostCsvPath = path.join(RESULTS_DIR, `lost-update-${ts}.csv`);
    fs.writeFileSync(lostCsvPath, toCsv(lostRows.map(lostCsvRow)));
    console.log(`wrote ${path.relative(ROOT, lostCsvPath)} (${lostRows.length} rows)`);
  }

  if (!args.noMd) {
    updateExperimentsMd({ batchId, streamRows, lostRows, streamCsvPath, lostCsvPath });
    console.log(`updated ${path.relative(ROOT, EXPERIMENTS_MD)}`);
  }

  await closeRedis();
  await closePools();
  console.log(`bench done: batch ${batchId}`);
}

function streamCsvRow(r: StreamRow): Record<string, unknown> {
  return {
    run_id: r.runId, experiment: 'STREAM_LIMIT', strategy: r.strategy, label: r.label,
    isolation_level: r.isolationUsed, mode: r.mode, concurrency: r.concurrency, accounts: r.accounts,
    max_streams: r.maxStreams, race_delay_ms: r.raceDelayMs, granted: r.granted, rejected: r.rejected,
    retries: r.retries, deadlocks: r.deadlocks, lock_timeouts: r.lockTimeouts, errors: r.errors,
    violations: r.violations, p50_ms: r.p50Ms, p95_ms: r.p95Ms, throughput_rps: r.throughputRps,
    wall_ms: r.wallMs, batch_id: r.batchId, trial: r.trial,
  };
}

function lostCsvRow(r: LostRow): Record<string, unknown> {
  return {
    run_id: r.runId, experiment: 'LOST_UPDATE', strategy: r.variant, isolation_level: r.isolationUsed,
    mode: 'NORMAL', concurrency: r.increments, accounts: 1, max_streams: 1, race_delay_ms: r.raceDelayMs,
    granted: r.succeeded, rejected: 0, retries: r.retries, deadlocks: r.deadlocks, lock_timeouts: 0,
    errors: r.errors, violations: r.lost, p50_ms: r.p50Ms, p95_ms: r.p95Ms, throughput_rps: r.throughputRps,
    wall_ms: r.wallMs, batch_id: r.batchId, trial: r.trial, final_count: r.finalCount,
  };
}

// -------------------------------------------------------------- markdown tables

function gitShortSha(): string | null {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return null; }
}

function md(headers: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function updateExperimentsMd(args_: {
  batchId: string; streamRows: StreamRow[]; lostRows: LostRow[]; streamCsvPath: string | null; lostCsvPath: string | null;
}) {
  const { batchId, streamRows, lostRows, streamCsvPath, lostCsvPath } = args_;
  const sha = gitShortSha();
  const now = new Date().toISOString();

  const labels = [...new Set(streamRows.map((r) => r.label))];
  const harshConcurrency = concurrencies.length ? Math.max(...concurrencies) : 0;
  const harshDelay = delays.length ? Math.max(...delays) : 0;

  // Table A: one row per label at the harshest cell (max concurrency, 1 account, max delay).
  const tableARows = labels.map((label) => {
    const rows = streamRows.filter((r) => r.label === label && r.concurrency === harshConcurrency && r.accounts === 1 && r.raceDelayMs === harshDelay);
    if (rows.length === 0) return [label, 0, '—', '—', '—', '—', '—', '—'];
    const withViol = rows.filter((r) => r.violations > 0).length;
    return [
      label, rows.length, `${Math.round((withViol / rows.length) * 100)}%`, round2(mean(rows.map((r) => r.violations))),
      round2(mean(rows.map((r) => r.retries))), round2(mean(rows.map((r) => r.deadlocks))),
      rows.reduce((a, r) => a + r.errors, 0), round2(median(rows.map((r) => r.p95Ms))), round2(mean(rows.map((r) => r.throughputRps))),
    ];
  });
  const tableA = md(
    ['strategy', 'trials', '% violating', 'mean violations', 'mean retries', 'mean deadlocks', 'errors', 'median p95 (ms)', 'mean throughput (rps)'],
    tableARows,
  );

  // Tables B/C: mean p95 by concurrency, at accounts=1 (B) and accounts=16 (C), delay=harshDelay.
  function latencyTable(accounts: number): string {
    const rows = labels.map((label) => [
      label,
      ...concurrencies.map((c) => {
        const cellRows = streamRows.filter((r) => r.label === label && r.concurrency === c && r.accounts === accounts && r.raceDelayMs === harshDelay);
        return cellRows.length ? round2(mean(cellRows.map((r) => r.p95Ms))) : '—';
      }),
    ]);
    return md(['strategy', ...concurrencies.map((c) => `c=${c}`)], rows);
  }
  const tableB = latencyTable(1);
  const tableC = latencyTable(16);

  // Table D: lost update per variant x N at the max race delay used.
  const luVariantsPresent = [...new Set(lostRows.map((r) => r.variant))];
  const luNsPresent = [...new Set(lostRows.map((r) => r.increments))].sort((a, b) => a - b);
  const harshLuDelay = luDelays.length ? Math.max(...luDelays) : 0;
  const tableDRows: (string | number)[][] = [];
  for (const variant of luVariantsPresent) {
    for (const n of luNsPresent) {
      const rows = lostRows.filter((r) => r.variant === variant && r.increments === n && r.raceDelayMs === harshLuDelay);
      if (rows.length === 0) continue;
      tableDRows.push([
        variant, n, round2(mean(rows.map((r) => r.finalCount))), round2(mean(rows.map((r) => r.lost))),
        round2(mean(rows.map((r) => r.retries))), round2(median(rows.map((r) => r.p95Ms))),
      ]);
    }
  }
  const tableD = md(['variant', 'N', 'mean final count', 'mean lost', 'mean retries', 'median p95 (ms)'], tableDRows);

  const links: string[] = [];
  if (streamCsvPath) links.push(`- [${path.basename(streamCsvPath)}](results/${path.basename(streamCsvPath)})`);
  if (lostCsvPath) links.push(`- [${path.basename(lostCsvPath)}](results/${path.basename(lostCsvPath)})`);

  const section = `_Generated by \`npm run bench\` on ${now}${sha ? ` (commit ${sha})` : ''}. Batch \`${batchId}\`. ` +
    `Matrix: ${STREAM_CELLS.length} strategy/isolation combinations × concurrency {${concurrencies.join(', ')}} × ` +
    `accounts {${accountsList.join(', ')}} × race delay {${delays.join(', ')} ms} × ${streamTrials} trial(s); ` +
    `lost update: ${LU_VARIANTS.length} variants × N {${luIncrements.join(', ')}} × delay {${luDelays.join(', ')} ms} × ${luTrials} trial(s). ` +
    `MySQL 8.4 in Docker on ${os.type()} ${os.release()}._\n\n` +
    `### Table A: stream limit, harshest cell (concurrency ${harshConcurrency}, 1 account, ${harshDelay} ms delay)\n\n${tableA}\n\n` +
    `### Table B: mean p95 latency (ms) by concurrency, 1 account\n\n${tableB}\n\n` +
    `### Table C: mean p95 latency (ms) by concurrency, 16 accounts\n\n${tableC}\n\n` +
    `### Table D: lost update, ${harshLuDelay} ms delay\n\n${tableD}\n\n` +
    (links.length ? `**Raw data:**\n${links.join('\n')}\n` : '');

  const current = fs.existsSync(EXPERIMENTS_MD) ? fs.readFileSync(EXPERIMENTS_MD, 'utf8') : '';
  const startMarker = '<!-- bench:start -->';
  const endMarker = '<!-- bench:end -->';
  const replacement = `${startMarker}\n${section}${endMarker}`;

  let next: string;
  if (current.includes(startMarker) && current.includes(endMarker)) {
    next = current.replace(new RegExp(`${startMarker}[\\s\\S]*${endMarker}`), replacement);
  } else if (current.length > 0) {
    next = `${current.trimEnd()}\n\n${replacement}\n`;
  } else {
    next = `# Experiments\n\n${replacement}\n`;
  }
  fs.writeFileSync(EXPERIMENTS_MD, next);
}

main().catch(async (err) => {
  console.error(err);
  await closeRedis();
  await closePools();
  process.exit(1);
});
