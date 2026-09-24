# Phase 4: Concurrency Lab (implementation plan)

**Goal (PLAN.md §8.1, §8.2, §8.5, §9, §10 Phase 4):** turn the single-trial race preview into a real experiment harness. It repeats trials, saves every trial to `experiment_run`, adds the lost-update experiment (song play counter), provides a CLI benchmark that writes CSV plus a Markdown summary, and adds the lab tests from §9.

**Done when:**
1. The lab tests below pass. For each safe strategy, 20 trials × 50 concurrent claims give 0 violations. NAIVE and TXN_RR violate in at least one trial. Lost update: NAIVE_RMW loses increments; ATOMIC, LOCKED and CAS end at exactly N.
2. "Compare all" (friendly) and the new Lab tab (nerds) reproduce the expected pattern of PLAN §6.4 from data **read back from the database**.
3. `npm run bench -- --quick` produces CSV files in `docs/results/` and a summary table in `docs/experiments.md`. The full `npm run bench` works too.

Read `CLAUDE.md` first. Work on branch `phase-4`, created from `phase-3`. Do the steps in order and keep the suite green after each one.

---

## 0. Orientation: what exists today

- `server/src/lab/raceRunner.ts` exports `runRace(params, restoreIndexFor)`, **one trial**:
  1. Resets all lab accounts: deletes their sessions and events, sets `max_streams`, `state_version = 0`.
  2. Sets the unique index for the strategy.
  3. Pre-acquires `concurrency` connections from `labPool` and releases them on a barrier. Request `i` targets lab account `i % accounts`, device `floor(i / accounts)`.
  4. Runs `executeClaim`, then the invariant query (`lab/invariant.ts`).
  5. Restores the index for `restoreIndexFor` and returns a `RaceResult` (see the type in the file).
  6. Nothing is persisted.
- `server/src/routes/lab.ts`: `POST /api/lab/race` (zod-validated body), guarded by an **in-process** `running` flag → 409 BUSY.
- `experiment_run` table (db/schema.sql) exists and is empty.
- Web:
  - `pages/StressTestPage.tsx` (friendly) calls `POST /lab/race` once per strategy.
  - `components/nerds/StressTab.tsx` ("Stress data" tab) builds its charts from the **browser's action trace** (localStorage).
  - `lib/trace.ts#summarize` has a `/lab/race` case.
- `scripts/bench.ts` is a stub that exits 1.
- `server/test/strategies.test.ts` has a small 20-way race smoke test. Keep it.

---

## Step 1: schema: group trials into batches

`experiment_run` has no way to group the trials of one run or the strategies of one comparison, and nowhere to store error samples. Add:

```sql
-- in CREATE TABLE experiment_run, after `throughput_rps`
  wall_ms         DECIMAL(10,2) NOT NULL DEFAULT 0,
  batch_id        CHAR(36)      NULL,              -- one "Run"/"Compare all"/bench invocation
  trial           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  source          ENUM('UI','API','BENCH','TEST') NOT NULL DEFAULT 'API',
  detail          JSON          NULL,              -- errorSamples, lost-update final count, etc.
  INDEX ix_run_batch (batch_id),
  INDEX ix_run_experiment_time (experiment, created_at)
```

- Edit `db/schema.sql`, then `npm run db:reset`. Data is disposable; the seed rebuilds everything.
- `docs/normalization.md` §6 (`experiment_run`): FDs unchanged (`run_id →` everything). `batch_id` is **not** a key: many trials share it. Mention that `(batch_id, strategy, trial)` is unique in practice but not declared, because rows are inserted by one writer. Stays BCNF.
- Add the deviation to `CLAUDE.md` §6.
- Run `npm test`: all 105 must still pass.

## Step 2: cross-process lab lock

The in-process `running` flag can't stop the CLI bench (a separate process) or a test run from clashing with the UI. Both reset the same lab accounts and toggle the same index. Use a **MySQL named lock**, which is also a nice DB concept for the report.

New file `server/src/lab/labLock.ts`:

```ts
export class LabBusyError extends Error {}
/** Runs fn while holding GET_LOCK('playsync.lab'). Throws LabBusyError immediately if another
 *  process/request holds it. The lock lives on one dedicated connection, released in finally. */
export async function withLabLock<T>(fn: () => Promise<T>): Promise<T>
```

- Take a connection from `appPool`. Run `SELECT GET_LOCK('playsync.lab', 0) AS got`. If `got !== 1`, release the connection and throw `LabBusyError`.
- In `finally`: `SELECT RELEASE_LOCK('playsync.lab')`, then release the connection. A named lock is tied to the session, so if the process dies MySQL frees it automatically. Say so in a comment.
- `routes/lab.ts`: remove the `running` flag. Map `LabBusyError` → `ServiceError(409, 'BUSY', 'another experiment is running (UI, bench or tests)')`.
- **Tests must use it too.** The lab tests in Step 6 run inside `withLabLock`. If a developer is running the bench at the same time, the test fails fast with a clear message instead of producing garbage.

## Step 3: race runner: trials, persistence, aggregation

Refactor `server/src/lab/raceRunner.ts`. Keep `runRace` exported, because `strategies.test.ts` doesn't use it but `routes/lab.ts` does. Change it so **the index is managed by the caller**:

```ts
export async function runRace(p: RaceParams): Promise<RaceResult>   // no index handling, no lock
```

New pieces (same file, or `lab/experiment.ts`):

```ts
export interface ExperimentRequest extends RaceParams {
  trials: number;                    // 1..50
  batchId?: string;                  // reuse to group several strategies of one comparison
  source: 'UI' | 'API' | 'BENCH' | 'TEST';
}
export interface TrialResult extends RaceResult { runId: number; trial: number; batchId: string }
export interface Aggregate {
  strategy: StrategyName; isolationUsed: string; trials: number;
  violationsTotal: number; trialsWithViolations: number; violationsMean: number; violationsMax: number;
  grantedMean: number; retriesMean: number; deadlocksMean: number; lockTimeoutsTotal: number; errorsTotal: number;
  p50Median: number; p95Median: number; throughputMean: number;
}
export async function runStreamLimitExperiment(req: ExperimentRequest, restoreIndexFor: StrategyName):
  Promise<{ batchId: string; trials: TrialResult[]; aggregate: Aggregate }>
```

`runStreamLimitExperiment` does the following, all inside `withLabLock`:

1. **Validate** (throw `RaceParamError`):
   - `concurrency ≤ config.LAB_POOL_SIZE`. PLAN §8.1 guard: if the pool is smaller than the concurrency, requests queue and the race disappears.
   - `concurrency ≤ accounts × 64`.
   - CONSTRAINT with `maxStreams > 1` is not allowed.
   - `trials` between 1 and 50.
2. `batchId = req.batchId ?? randomUUID()`.
3. Set the unique index **once**: `setUniqueIndex(conn, strategies[strategy].needsUniqueIndex)`.
4. `try`: for `trial = 1..trials`, call `runRace(req)`, then `saveRun(...)`. Collect the results.
5. `finally`: `setUniqueIndex(conn, strategies[restoreIndexFor].needsUniqueIndex)`. The index must be restored even if a trial throws.
6. Compute the `Aggregate` (means rounded to 2 decimals; medians via sort).

`saveRun(row)` inserts one `experiment_run` row:
- `experiment = 'STREAM_LIMIT'`, `isolation_level = isolationUsed` (for example `'AUTOCOMMIT'`, `'READ COMMITTED'`; fits VARCHAR(20)).
- `mode`, `concurrency`, `accounts`, `max_streams`, `race_delay_ms`, `granted`, `rejected`, `retries`, `deadlocks`, `lock_timeouts`, `errors`, `violations`, `p50_ms`, `p95_ms`, `throughput_rps`, `wall_ms`, `batch_id`, `trial`, `source`.
- `detail = { errorSamples }`.
- Return `insertId`.

`runRace` must still do its per-trial reset first (sessions/events of lab accounts, `max_streams`, `state_version = 0`). Each trial starts from a clean slate.

## Step 4: lost-update experiment (PLAN §8.2)

New file `server/src/lab/lostUpdate.ts`. It demonstrates the **classic lost update** on one row: two read-modify-writes of the same `song.play_count`.

```ts
export const LOST_UPDATE_VARIANTS = ['NAIVE_RMW', 'ATOMIC', 'LOCKED', 'CAS'] as const;
export type LostUpdateVariant = (typeof LOST_UPDATE_VARIANTS)[number];
export interface LostUpdateParams { variant: LostUpdateVariant; increments: number; raceDelayMs: number }
export interface LostUpdateResult extends LostUpdateParams {
  isolationUsed: string; succeeded: number; errors: number; retries: number; deadlocks: number;
  finalCount: number; lost: number;           // lost = succeeded - finalCount
  p50Ms: number; p95Ms: number; wallMs: number; throughputRps: number;
}
export async function runLostUpdate(p: LostUpdateParams): Promise<LostUpdateResult>
export async function runLostUpdateExperiment(req: LostUpdateParams & { trials: number; batchId?: string; source: ... }):
  Promise<{ batchId: string; trials: (LostUpdateResult & { runId: number; trial: number })[]; aggregate: ... }>
```

- **Target row:** the song with the highest `song_id` (`SELECT MAX(song_id) FROM song`). Reset `play_count = 0` before each trial. The UI never shows `play_count`, so this is safe.
- Pre-acquire `increments` connections from `labPool` (same guard: ≤ `LAB_POOL_SIZE`), then use a barrier, as in the race runner. Measure latency per worker.
- Variants (comment each with the anomaly it allows or prevents, like the strategy files):

| Variant | Statements | Isolation label | Expected |
|---|---|---|---|
| `NAIVE_RMW` | autocommit `SELECT play_count` → `sleep(raceDelayMs)` → `UPDATE song SET play_count = ? WHERE song_id = ?` (value read + 1) | `AUTOCOMMIT` | **lost updates**: many workers write the same value |
| `ATOMIC` | `UPDATE song SET play_count = play_count + 1 WHERE song_id = ?` (the read-modify-write happens inside one statement under the row X lock; `raceDelayMs` is irrelevant, so say so) | `AUTOCOMMIT` | exactly N |
| `LOCKED` | `withRetry(withTx(conn,'READ COMMITTED', …))`: `SELECT play_count … FOR UPDATE` → sleep → `UPDATE … SET play_count = ?` | `READ COMMITTED` | exactly N, serialized (slow: ≈ N × delay) |
| `CAS` | loop: `SELECT play_count` → sleep → `UPDATE song SET play_count = ? WHERE song_id = ? AND play_count = ?`; `affectedRows === 0` → `stats.retries++`, back off 0–5 ms with jitter, retry (cap 500 attempts, then count an error) | `AUTOCOMMIT` | exactly N, retries grow ~N² / 2 |

- `lost = succeeded − finalCount`. This is the precise definition: increments that **reported success** but aren't in the counter. PLAN §8.2 says `N − final`; that is identical when there are no errors, but with ours a CAS worker that gives up counts as an error, not a lost update. Record this clarification in `docs/experiments.md`.
- Persist each trial to `experiment_run`:
  - `experiment = 'LOST_UPDATE'`, `strategy = variant`, `isolation_level`, `mode = 'NORMAL'`, `concurrency = increments`, `accounts = 1`, `max_streams = 1`, `race_delay_ms`, `granted = succeeded`, `rejected = 0`, `retries`, `deadlocks`, `lock_timeouts = 0`, `errors`, `violations = lost`, latencies, `wall_ms`, `batch_id`, `trial`, `source`.
  - `detail = { finalCount }`.
- Run inside `withLabLock` (it uses `labPool` and shares the "one experiment at a time" rule).

## Step 5: API

`server/src/routes/lab.ts`. Validate every body with zod. Map `RaceParamError` → 400 `BAD_PARAMS` and `LabBusyError` → 409 `BUSY`.

| Method & path | Body | Response |
|---|---|---|
| `POST /api/lab/race` | unchanged (single trial) | **same `RaceResult` shape as today** plus `runId`, `batchId`. Internally `runStreamLimitExperiment({ …body, trials: 1, source: 'UI' })`. The friendly page keeps working unchanged. Accept optional `batchId` so "Compare all" groups its six runs. |
| `POST /api/lab/experiments` | `{ strategy, isolation?, concurrency, accounts, maxStreams, raceDelayMs, mode, trials (1–50, default 10), batchId? }` | `{ batchId, trials: TrialResult[], aggregate }`. `source: 'API'`. |
| `POST /api/lab/lost-update` | `{ variant, increments (2–100, default 50), raceDelayMs (0–200, default 20), trials (1–20, default 5), batchId? }` | `{ batchId, trials, aggregate }` |
| `GET /api/lab/runs` | query: `experiment?`, `batchId?`, `strategy?`, `limit` (1–1000, default 300) | rows newest first, camelCased: `{ runId, experiment, strategy, isolationLevel, mode, concurrency, accounts, maxStreams, raceDelayMs, granted, rejected, retries, deadlocks, lockTimeouts, errors, violations, p50Ms, p95Ms, throughputRps, wallMs, batchId, trial, source, detail, createdAt }`. DECIMAL columns come back from mysql2 as **strings**; convert them with `Number()`. |

One strategy or variant per request, on purpose. The UI loops over strategies so it can show progress, and no HTTP request runs for minutes.

## Step 6: tests (PLAN §9 lab items)

New file `server/test/lab.test.ts`. Call the functions directly (not over HTTP) for speed, with `source: 'TEST'`. Give the file `{ timeout: 180_000 }` on its long `it`s. In `afterAll`: drop the unique index (`setUniqueIndex(conn, false)`), reset `lab_01`, and `closePools()`.

1. For each of `PESSIMISTIC`, `OPTIMISTIC`, `SERIALIZABLE`, `CONSTRAINT`: `runStreamLimitExperiment({ concurrency: 50, accounts: 1, maxStreams: 1, raceDelayMs: 20, mode: 'NORMAL', trials: 20 })` → **every** trial has `violations === 0`.
2. `NAIVE` and `TXN_RR` (default isolation): 5 trials, same parameters → `trialsWithViolations > 0`.
3. `TXN_RR` with `isolation: 'READ COMMITTED'`: also violates. This is H1: "at both RC and RR".
4. TAKEOVER mode, each safe strategy, 5 trials × 30 → every trial has `violations === 0`. Some requests may end in `errors` (retries exhausted); that's allowed.
5. Persistence: one experiment with `trials: 3` writes exactly 3 rows with the same `batch_id`, `trial` 1..3, and the right `experiment`, `strategy` and `source`. `GET /api/lab/runs?batchId=` (supertest) returns them with numeric `p95Ms`.
6. Guards:
   - `concurrency > LAB_POOL_SIZE` → `RaceParamError`.
   - CONSTRAINT with `maxStreams: 2` → `RaceParamError`, and the index state is unchanged.
7. Index restore: after a CONSTRAINT experiment with `restoreIndexFor: 'PESSIMISTIC'`, the index is absent. After a PESSIMISTIC experiment with `restoreIndexFor: 'CONSTRAINT'`, it's present (then drop it).
8. Lab lock: while one `withLabLock` is held (an open promise), a second call throws `LabBusyError`. Afterwards the lock is free again.
9. Lost update, N = 50, delay 20 ms, 3 trials:
   - `NAIVE_RMW`: `lost > 0` in at least one trial.
   - `ATOMIC`, `LOCKED`, `CAS`: `finalCount === 50` and `lost === 0` in every trial (CAS: `errors === 0`).

Also update `server/test/demo-api.test.ts`: the `/lab/race` responses now include `runId` and `batchId`. Add one test that a "Compare all"-style pair of calls with the same `batchId` is grouped.

Add a script to `server/package.json`: `"test:fast": "vitest run --exclude test/lab.test.ts"`. `npm test` still runs everything. Report the new total runtime in your summary (expect ~1–3 minutes, mostly SERIALIZABLE at 50-way).

## Step 7: web: data from the database

### 7a. `lib/api.ts` and `lib/trace.ts`
- Types: `ExperimentRun` (the `GET /lab/runs` row), `TrialResult`, `Aggregate`, `LostUpdateResult`, `LostUpdateVariant`.
- `summarize()` cases:
  - `/lab/experiments`: "experiment PESSIMISTIC ×50, 20 trials → 0 violations in 20/20".
  - `/lab/lost-update`: "lost update NAIVE_RMW ×50 → counter 7, 43 lost".
  - Keep the `/lab/race` case.

### 7b. Friendly `/stress` (StressTestPage.tsx)
- A `Segmented` switch at the top: **"Pressing Play together"** (the existing experiment) | **"Counting plays"** (new).
- "Compare all" sends one shared `batchId` (generate it with `uuid()`) on all six `/lab/race` calls.
- Under a finished result, add a small line: "Saved to the lab history". Link it to `/nerds?tab=runs&batch=<batchId>`.
- **Counting plays** (lost update), in plain language:
  - Intro: "Every time someone finishes a song, its play counter goes up by one. What if 50 people finish at the same moment?"
  - Control: slider "People finishing at once" (2–100).
  - Methods, as cards:
    - `NAIVE_RMW` = "Read, then write" (risky): "Each phone reads the number, adds one, writes it back. Two phones can read the same number."
    - `ATOMIC` = "Let the database add": "The database does the +1 itself, one at a time."
    - `LOCKED` = "Take a number": "Each phone waits its turn to read and write."
    - `CAS` = "Check it didn't change": "Write only if the number is still what you read; otherwise try again."
  - Verdicts:
    - ❌ "50 people listened, but the counter says 7. 43 plays were lost."
    - ✅ "50 people listened, and the counter says 50."
  - A dot row: green = counted, rose = lost.
  - A "Compare all" button runs the four variants.
- Never show SQL, strategy ids or HTTP codes on this page.

### 7c. Stats for nerds
- **Rename the "Stress data" tab to "Experiment runs"** and change its id to `runs`. Also accept the old `?tab=stress`, mapping it to `runs`, so existing links keep working. Rewrite `components/nerds/StressTab.tsx` (rename it to `RunsTab.tsx`) to read `GET /api/lab/runs` instead of the browser trace:
  - Filters: experiment (STREAM_LIMIT / LOST_UPDATE), batch (a dropdown of recent batch ids with their time and strategies, plus "all"), accounts, race delay.
  - Charts (recharts; label angle −30° on category axes; `grid-cols-1` on mobile):
    1. **Violations by strategy**: mean per trial, plus "% of trials with a violation".
    2. **Retries and deadlocks by strategy**: means. Side by side, **not stacked**.
    3. **p95 latency vs concurrency**: `LineChart`, one line per strategy, x = concurrency. Only draws when the filtered runs cover several concurrencies, as the bench produces; otherwise show a hint to run the bench.
    4. **Throughput by strategy**.
  - A table of the filtered runs: run id, time, batch (first 8 chars), trial, source, strategy, isolation, concurrency, accounts, max, delay, granted, rejected, errors, deadlocks, retries, violations (rose when > 0), p50, p95, rps. Newest first, `overflow-auto`.
  - A "Refresh" button. Refetch automatically when a trace entry for `/lab/*` appears (use `useTrace()`), so runs started in another tab show up.
- **New tab "Lab"** (`?tab=lab`, new file `components/nerds/LabTab.tsx`): the full-control lab from PLAN §7 item 3.
  - Stream-limit form:
    - strategies as checkboxes (default: all six);
    - isolation override (only applied to TXN_RR);
    - concurrency 2–100, accounts {1, 2, 4, 8, 16}, max streams 1–3, race delay {0, 5, 20, 50}, mode, trials 1–50 (default 10).
  - **Run** loops over the selected strategies (one `POST /lab/experiments` each, sharing one `batchId`). It shows progress ("SERIALIZABLE 3/6…") and skips CONSTRAINT with a note when max streams > 1.
  - Show the aggregate table as results arrive: strategy, isolation, trials, violations total, trials with violations, mean retries, mean deadlocks, errors, p50 median, p95 median, throughput.
  - Link: "Open in Experiment runs →" to the batch.
  - Lost-update form: variants as checkboxes, increments, race delay, trials. Same flow via `/lab/lost-update`.
  - On `409 BUSY`, show "Another experiment is running (maybe the CLI bench or the tests). Try again when it finishes."
  - Put the tab between "Checks" and "Action trace" in `NerdsPage.tsx`'s `TABS`.

## Step 8: CLI bench (PLAN §8.5)

Implement `scripts/bench.ts`. It runs in-process. Import from `../server/src/...` with `.js` suffixes, as the server does; `tsx` resolves them. The server's `config.ts` loads `.env` from the repo root regardless of the working directory.

- **Arguments** (parse `process.argv` yourself; no new dependencies):
  - `--quick`: trials 2, concurrency {2, 32}, delay {20}, lost-update N {50}.
  - `--trials N`: overrides the trial count.
  - `--only stream|lost`
  - `--no-md`: skip the Markdown update.
- **Matrix (full):**
  - Stream limit:
    - strategies: NAIVE, TXN_RR@REPEATABLE READ, TXN_RR@READ COMMITTED, SERIALIZABLE, PESSIMISTIC, OPTIMISTIC, CONSTRAINT
    - concurrency {2, 8, 32, 64}; accounts {1, 16}; race delay {0, 20}
    - mode NORMAL, max streams 1, trials 10
    - That is 7 × 4 × 2 × 2 × 10 = 1120 trials.
  - Lost update: 4 variants × N {10, 50} × delay {0, 20} × 5 trials.
- One `batchId` per bench invocation, with `source: 'BENCH'`. Pass `restoreIndexFor: config.DEFAULT_STRATEGY`. **Print a warning** at start: "If the dev server's live strategy is CONSTRAINT, re-select it after the bench (the bench restores the index for DEFAULT_STRATEGY)."
- Print progress: `[137/1120] PESSIMISTIC c=32 a=1 d=20 trial 7 → viol 0, retries 0, p95 41 ms`. Print an estimated time remaining after the first 20 trials.
- If `withLabLock` throws `LabBusyError`, print "Another experiment is running; stop the UI experiment or the tests and retry" and `exit(2)`.
- **Outputs:**
  - `docs/results/stream-limit-<YYYYMMDD-HHmmss>.csv` and `docs/results/lost-update-<…>.csv`, one row per trial with every column of `experiment_run` plus `batch_id` and `trial`. Write the header yourself; quote strings containing commas.
  - `docs/experiments.md`: replace everything between `<!-- bench:start -->` and `<!-- bench:end -->` (create the markers if missing). Inside:
    - bench date, batch id, git short SHA (`git rev-parse --short HEAD` via `child_process`; optional), matrix, machine note ("MySQL 8.4 in Docker on <os>");
    - **Table A:** stream limit, one row per (strategy × isolation) at the harshest cell (concurrency 64, accounts 1, delay 20): trials, % trials violating, mean violations, mean retries, mean deadlocks, errors, median p95, mean throughput.
    - **Table B:** mean p95 by concurrency (columns 2/8/32/64) per strategy at accounts 1, delay 20. **Table C:** the same at accounts 16 (this shows H2: pessimistic stays flat when load is spread).
    - **Table D:** lost update per variant × N at delay 20: mean final count, mean lost, mean retries, median p95.
    - Links to the CSV files.
- Always `closePools()` at the end, and exit 0.
- Commit **one full bench run's** CSV and summary at the end of the phase (after the user approves). Don't commit `--quick` outputs; delete them.

## Step 9: `docs/experiments.md` (hand-written part, above the markers)

- **Purpose and the research question.** Copy it from PLAN §1.
- **Method:**
  - lab accounts;
  - pre-acquired connections plus a barrier (and why);
  - the race window (`raceDelayMs`) and why it's needed (to make races reproducible on one machine);
  - the invariant query (quote it) and `violations = Σ(active − max_streams)`;
  - the lost-update definition (`lost = succeeded − finalCount`, and why not `N − final`);
  - the named lab lock;
  - what `errors` means (retries exhausted, not a violation).
- **Hypotheses H1–H6** (PLAN §11), each followed by "Result:" and a placeholder that the author fills in from the tables. Don't invent results; the bench tables are the evidence.
- **Threats to validity:** single machine; Docker; the artificial race window; retry cap 5; results vary run to run (that's why there are 10 trials).

## Step 10: README + CLAUDE.md

- README:
  - "The web UI" table: `/stress` now has two experiments; the nerds tabs now include **Lab** and **Experiment runs**.
  - "Scripts": `npm run bench` with `--quick`, and `npm -w server run test:fast`.
  - Test section: mention the lab tests and the runtime.
- `CLAUDE.md`:
  - Status: Phase 4 done.
  - Update the repo map: `lab/labLock.ts`, `lab/lostUpdate.ts`, new tabs.
  - Record the deviations: schema columns, the lab lock, the `lost` definition, the "Lab"/"Experiment runs" tabs instead of `/lab`.
  - Update the baseline test count.

---

## Acceptance checklist (run all of it before reporting)

```bash
npm run db:reset                  # the schema changed
npm run typecheck
npm test                          # everything green; note the runtime
npm -w web run build
npm run bench -- --quick          # writes CSV + summary; then delete the --quick outputs
```

In the browser (`npm run dev`, desktop and 375 px):
1. `/stress` → "Compare all" (Pressing Play together) shows NAIVE and TXN_RR as broken and the other four as protected. The link opens nerds → Experiment runs filtered to that batch, and the charts show the same pattern **from the database**.
2. `/stress` → "Counting plays" → "Compare all": "Read, then write" loses plays; the other three count exactly N.
3. Nerds → Lab: run PESSIMISTIC and OPTIMISTIC with trials 10 → the aggregate shows 0 violations. OPTIMISTIC has retries and PESSIMISTIC has none.
4. While `npm run bench` runs in a terminal, pressing Run in the UI shows the friendly "another experiment is running" message (409 BUSY).
5. Nerds → Checks for `brij` stays all green (the lab never touches `brij`).
6. No page scrolls sideways at 375 px, and there are no JavaScript errors in the console.

Then **stop**. Report what you built, the verification commands, the test runtime, a few headline numbers from the quick bench, and every deviation. Don't start Phase 5 until the user says so.

## Pitfalls

- **Pool starvation hides races.** Always pre-acquire all connections before opening the barrier. Never lower `LAB_POOL_SIZE` below 100.
- **Index restore:** use `try/finally`. A thrown trial must not leave the unique index behind. If it stays, NAIVE looks "safe" in every later run.
- DECIMAL/BIGINT from mysql2: `COUNT(*)` and BIGINT come back as numbers (safe range); **DECIMAL comes back as strings**. Convert them.
- Don't hold the lab lock connection inside `labPool`. Take it from `appPool`, so it can't starve the race itself.
- SERIALIZABLE at 50-way produces many deadlocks and some `errors`. Assert only `violations === 0` for the safe strategies, never `errors === 0`, except for the lost-update CAS/LOCKED/ATOMIC variants.
- Don't run the bench and the test suite at the same time. The lab lock makes the second one fail fast; that's intended.
- The friendly page must stay friendly: variant ids and numbers like retries belong in nerds only.
