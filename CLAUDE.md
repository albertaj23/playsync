# PlaySync: guide for coding agents

Read this file completely before touching code. It tells you what the project is, what is already built, the rules the code follows, and how to work here. The original specification is [docs/PLAN.md](docs/PLAN.md). Where this file and PLAN.md disagree, **this file wins**: the differences are deliberate decisions made during Phases 0–3 (see "Deviations from PLAN.md").

## 1. What this project is

A DBMS coursework project. A tiny music app where one account has several devices (MacBook, iPhone, iPad, Browser) and may play on at most `max_streams` of them at once. The app is a **concurrency-control lab**: it protects one invariant and measures how six strategies protect it (or fail to) on a real MySQL/InnoDB database.

> **Invariant:** for every account, the number of sessions with `status = 'PLAYING'` and `lease_expires_at > NOW(3)` is ≤ `account.max_streams`.

The two-devices-press-Play race is **write skew / a phantom**, not a lost update. Lost update gets its own experiment (the song play counter).

## 2. Status

| Phase | What | State | Branch |
|---|---|---|---|
| 0 | Scaffold, Docker MySQL, health endpoint | ✅ done | `main` |
| 1 | Schema, seed, ER + normalization docs | ✅ done | `main` |
| 2 | Six strategies, playback service, REST API | ✅ done | `phase-2` |
| 3 | Real-time sync, lease reaper, friendly UI + Stats for nerds | ✅ done | `phase-3` |
| 4 | Concurrency Lab: trials, persistence, lost update, bench | ✅ done | `phase-4` |
| 5 | Transaction Stepper | ✅ done. Plan: [docs/implementation/phases-5-7.md](docs/implementation/phases-5-7.md) | `phase-5` |
| UI | Friendly light/dark redesign, mascot, anime.js motion, Watermelon components | ✅ done, committed. [docs/implementation/phase-ui-playful.md](docs/implementation/phase-ui-playful.md), [docs/ui-voice.md](docs/ui-voice.md) | `phase-ui` |
| 5.5 | Simulation Control Room (`/sim`) | ✅ built (M1–M4), **uncommitted**. Plan: [docs/implementation/phase-sim.md](docs/implementation/phase-sim.md); design: [docs/simulation.md](docs/simulation.md) | `phase-sim` → `phase-nav` |
| NAV | Sidebar shell, story framework, pages as chapter stories, geometric scenes, neon sliders | ✅ built (N0–N7), **uncommitted**. Plan: [docs/implementation/phase-nav-ux.md](docs/implementation/phase-nav-ux.md) | `phase-nav` (current) |
| 6 | Index experiment + report docs | ✅ built, **uncommitted**: Stats for nerds → Index tab, [docs/concurrency.md](docs/concurrency.md), [docs/syllabus-map.md](docs/syllabus-map.md), H6 filled in [docs/experiments.md](docs/experiments.md) | `phase-nav` |
| 7 | Stretch: TRIGGER + REDIS_LEASE strategies, timestamp-ordering simulator, precedence-graph builder (Theory tab) | ✅ built, **uncommitted** | `phase-nav` |

Each branch is cut from the previous phase's branch. Nothing past Phase 1 is merged into `main`; don't merge unless the user asks.

## 3. Commands

Run everything from `playsync/`. Docker Desktop must be running.

```bash
npm install                # both workspaces
npm run db:up              # MySQL 8.4 in Docker on host port 3307; waits until schema + seed are loaded
npm run db:reset           # drop the volume and rebuild from db/schema.sql + db/seed.sql (needed after ANY schema change)
npm run db:shell           # mysql client inside the container
npm run dev                # server :4000 (tsx watch, auto-restarts on save) + Vite :5173 (proxies /api and /socket.io)
npm test                   # server suite (vitest, real DB, files run sequentially) + web unit tests
npm run typecheck          # tsc for server and web
npm -w web run build       # production bundle (a recharts chunk-size warning is expected)
npm -w server run test:fast # server tests, skipping the slow Concurrency Lab tests (~6 s vs ~40 s)
npm run bench               # full experiment matrix (~1200 trials, several minutes); --quick, --trials N, --only stream|lost, --no-md
```

Baseline now: **174 server tests pass (2 skipped by design; needs MySQL and Redis containers up) + 43 web tests**. `test:fast` skips the slow `lab`, `sim`, `indexExperiment` and `phase7` files. (End of Phase 5 it was 140 + 3.), typecheck clean, build succeeds. Keep it that way: never finish a step with a red suite.

## 4. Repository map

```
db/schema.sql, db/seed.sql     Loaded only when the Docker volume is created → schema changes need `npm run db:reset`.
docs/PLAN.md                   Original spec.  docs/er.md, docs/normalization.md: Phase 1 report material.
docs/experiments.md            Research question, method, hypotheses (H1-H6), bench-generated tables between <!-- bench:start/end -->.
docs/results/                  Per-trial CSVs written by `npm run bench` (gitignored except the one committed full run).
docs/implementation/           Phase plans for agents (this handoff).
scripts/bench.ts               CLI experiment matrix: runs in-process against the server's lab modules, writes CSV + docs/experiments.md.

server/src/
  config.ts                    zod-parsed env from ../.env (LEASE_MS 15000, HEARTBEAT_MS 5000, REAPER_MS 2000, pools 20/120).
  app.ts / index.ts            createApp() (used by supertest) / listen + socket.io + reaper + startup setLiveStrategy().
  db/pool.ts                   appPool (live app), labPool (experiments; must be ≥ max lab concurrency).
  db/tx.ts                     withTx(conn, isolation, fn), withRetry(fn, stats) (1213, 1205, OccConflictError), OccConflictError, sleep.
  db/errors.ts                 errno helpers (1062 dup, 1205 timeout, 1213 deadlock, 1452 FK).
  strategies/                  types.ts, common.ts (shared statements, grant/reject), one file per strategy, index.ts (registry + executeClaim = idempotency wrapper).
  services/playback.ts         claim (policy handling), heartbeat (fencing, 410), pause/release, settings, endAll, live strategy switch.
  services/accountState.ts     bumpVersion(), readSnapshot() (consistent READ ONLY snapshot).
  services/leaseReaper.ts      reapOnce(), startReaper(ms). Skips lab accounts and step_a/step_b.
  services/checks.ts           Six live SQL assertions per account (GET /api/accounts/:id/checks).
  realtime/                    presence.ts (online set), publisher.ts (publish-after-commit interface), socket.ts (rooms, join, pushes).
  lab/labLock.ts                withLabLock(fn): MySQL named lock (GET_LOCK('playsync.lab', 0)) so the UI/bench/tests can't clash on lab accounts. Throws LabBusyError if held.
  lab/raceRunner.ts            runRace() = one STREAM_LIMIT trial (index/lock managed by the caller). runStreamLimitExperiment() = trials + persistence + aggregate, holds the lab lock.
  lab/lostUpdate.ts            runLostUpdate() = one trial of a lost-update variant (NAIVE_RMW/ATOMIC/LOCKED/CAS). runLostUpdateExperiment() = trials + persistence.
  lab/persist.ts               saveRun()/listRuns(): experiment_run insert/read, DECIMAL→number conversion.
  lab/stats.ts                 percentile/mean/median/round2, shared by both experiment runners.
  lab/invariant.ts             The invariant query (checkInvariant).
  lab/stepper/                 Transaction Stepper: types, scenarios.ts (8 scenarios as data), engine.ts (singleton; T1/T2/admin unpooled connections, 300 ms WAITING race, busy flag, generation guard, KILL), locks.ts (data_locks/data_lock_waits inspector), emitter.ts (push interface -> socket room `stepper`).
  db/namedLock.ts             Generic MySQL GET_LOCK helper (withNamedLock); labLock.ts and the stepper build on it.
  routes/                      health, info (read-only UI endpoints + checks), accounts (state/settings/end-all/hello/admin strategy), playback,
                                lab (/lab/race single-trial, /lab/experiments, /lab/lost-update, /lab/runs), http.ts (asyncHandler + error mapping).
server/test/                   One file per area; helpers.ts has resetAccount(), deviceIds(), expireLease(), count()...  lab.test.ts is slow (~35s); test:fast excludes it.

web/src/
  lib/api.ts                   Typed fetch wrapper; returns {ok,status,body}, never throws on 4xx; records every non-GET call in the trace.
  lib/trace.ts                 Action trace (localStorage, shared across tabs) + summarize() for each endpoint.
  lib/socket.ts                useAccountState({accountId, deviceId?, enabled?, onSessionLost?}): one socket per caller; leaseRemaining().
  lib/versionedStore.ts        Drops snapshots with a LOWER stateVersion (equal is accepted).
  lib/useDeviceSession.ts      All device-client behaviour (claim, heartbeats, offline, adoption after reload, session_lost).
  components/ui.tsx            Card, Badge, Button, Dot, Equalizer, Stat, Field, inputCls, Code, Segmented, cx. Use these.
  components/device/           DeviceCard, NowPlaying, PlayerControls, deviceMessages (plain-language messages).
  components/nerds/            One file per Stats-for-nerds tab, including LabTab.tsx (full-control lab) and RunsTab.tsx (reads GET /lab/runs; tab id "runs", accepts legacy "stress").
  pages/                       HomePage, DevicePage (/device), NerdsPage (/nerds?tab=...), StressTestPage (/stress, `?exp=count`), devices/ (the /devices story), stress/ (the two stress stories).
  components/shell/            AppShell, Sidebar, TopBar, TabBar, MoreSheet, Tooltip, PhonePopover, ScrollChrome (layout vars --topbar-h/--sidebar-w/--tabbar-h in index.css).
  components/story/ + lib/story/ Story, Chapter (scene | work, gated), StickyStage, ChapterRail, NextHint, ActionBar, auto-advance; scroll bus + pure progress maths (tested).
  components/geo/              Geometric vocabulary (pieces.tsx), rail glyphs, useGeoScene (paused anime timeline scrubbed by scroll).
  components/sim/              Simulation page (SimStory), Relay conditions, Stage, feed, timeline, summary, compare, database overlay.
  components/watermelon/       Vendored: command-search, feature-tour, copy-confirm, adaptive-slider (see its README). `motion` is used ONLY here.
  lib/theory/                  Precedence graph and timestamp-ordering simulator (pure, tested); lib/motion.ts anime presets (reduced-motion safe).
  server extras: strategies/trigger.ts, strategies/redisLease.ts, strategies/artifacts.ts (prepareForStrategy: unique index / trigger), db/redis.ts, lab/indexExperiment.ts, lab/sim/*, routes/sim.ts.
```

## 5. Rules the code follows (do not break them)

### Database and transactions
- **Raw parameterized SQL only** via `mysql2/promise` (`?` placeholders). No ORM, no query builder. Identifiers you interpolate must come from a whitelist (see `withTx` validating the isolation level).
- **Global lock order: `account` → `device` → `playback_session` → `playback_event`.** Every correct path locks the account row first (`SELECT … FOR UPDATE`). CONSTRAINT deliberately violates this; that's a documented finding.
- **Every state change bumps `account.state_version`** (claim, pause, release, preempt, expire, settings). Heartbeats do not. OPTIMISTIC's correctness depends on this.
- `bumpVersion()` must run **after** any INSERT in the same transaction (LAST_INSERT_ID trick).
- **All time comparisons happen in SQL with `NOW(3)`.** Clients get `leaseRemainingMs` computed by the DB, never absolute times.
- Always `ROLLBACK` on error (withTx does) and release connections in `finally`.
- The unique index `uq_one_active_per_account` exists **only while CONSTRAINT is in use**. Add or drop it only through `setUniqueIndex(conn, present)`. Anything that changes it temporarily (the lab) must restore it for the live strategy afterwards.
- **Lab accounts (`lab_01…lab_16`, 64 devices each) belong to the lab.** Experiments reset them freely; the reaper skips them. The live UI uses `brij`. The stepper (Phase 5) uses `step_a` and `step_b`.

### Real-time
- **Publish only after COMMIT.** Service functions finish their transaction, then call `publish().accountChanged(id)` / `sessionLost(deviceId, …)`. Never publish from inside `withTx`.
- A socket disconnect never ends a session; the lease does.

### Tests
- They run against the real Dockerized MySQL, **sequentially** (`fileParallelism: false`). Each test file resets the accounts it uses via `resetAccount()`. Tests may end sessions on `brij`.
- Concurrency tests pre-acquire connections from `labPool` and release them through a barrier promise. Without that, requests queue at the pool and the race disappears.
- Anything that toggles the unique index must put it back (`setUniqueIndex(conn, false)` in `afterAll`).

### Frontend: two audiences
- **Friendly pages** (`/`, `/devices`, `/device`, `/stress`) are for someone who knows nothing about databases. Never show session ids, leases, versions, strategy names, HTTP codes or SQL there. Plain sentences and clear verdicts.
- **Stats for nerds** (`/nerds?tab=…`) shows everything technical, in monospace. Results of friendly actions are **verified** there (server-side checks), not just displayed.
- Light **and** dark themes (toggle in the top bar; tokens in `web/src/index.css`): use `stone-*` (themed), `fg/N` overlays and `violet-*` (= brand coral); emerald = playing/success, rose = failure, amber = warning, sky = offline. Never `bg-white/N`, `text-white` or Tailwind `zinc-*` in our own files. Reuse `components/ui.tsx`. Full rules: `docs/ui-voice.md`.
- Every page must work at **375 px wide with no horizontal page scroll**. Wide tables go in an `overflow-auto` wrapper. Grids need `grid-cols-1` at mobile or long content will stretch them.
- All HTTP goes through `api` from `lib/api.ts`, which traces automatically. Add a `summarize()` case in `lib/trace.ts` for any new state-changing endpoint.
- Strict TypeScript with `noUncheckedIndexedAccess`. No `any`; use real types or `unknown` plus narrowing.

## 6. Deviations from PLAN.md (deliberate; keep them)

1. MySQL is published on **host port 3307** (`DB_PORT`); a local MySQL occupies 3306.
2. `server/src/app.ts` builds the app; `index.ts` only listens (for supertest).
3. `ClaimInput` has extra optional `positionMs` (resume) and `isolation` (lab override). NAIVE's `defaultIsolation` is `'AUTOCOMMIT'`.
4. **A device's own session never blocks it.** Counts exclude the claiming device; a granted claim ends that device's previous PLAYING/PAUSED session. It does this with a plain SELECT plus UPDATE by primary key, because a searched UPDATE at REPEATABLE READ took gap locks that made TXN_RR deadlock artificially.
5. Policy TAKEOVER claims in TAKEOVER mode immediately (no reject-then-retry); REJECT downgrades a TAKEOVER request to NORMAL.
6. Lowering `max_streams` below the current active count returns **409 ACTIVE_EXCEEDS_LIMIT**.
7. CONSTRAINT expires stale rows itself but writes no EXPIRED events (the reaper does).
8. The reaper **skips lab accounts**.
9. The versioned store accepts **equal** versions (lease, presence and strategy change without a bump) and drops only lower ones.
10. "Online" = the device has a live socket (in-memory presence), not `last_seen_at`.
11. The 410 body includes `byDeviceName` when the reason is PREEMPTED. `session_lost` is also pushed with reason `ENDED` by end-all.
12. Extra endpoints: `/config`, `/songs`, `/strategies`, `/accounts/lookup`, `/accounts/:id/events`, `/accounts/:id/checks`, `/accounts/:id/end-all`, `/db/overview`, `/lab/race`.
13. **UI structure differs from PLAN §7.** Instead of `/wall` and `/lab`, there are friendly pages (`/devices` = the device wall, `/device`, `/stress` = friendly race lab) plus **Stats for nerds** for everything technical. `/wall`, `/playground` → `/devices`; `/race` → `/stress`. The full-control Concurrency Lab of PLAN §7 lives in Stats for nerds (Phase 4 adds a "Lab" tab).
14. Web unit tests exist (vitest in `web/`); `npm test` runs both workspaces.
15. (Phase 4) `experiment_run` gained `wall_ms`, `batch_id`, `trial`, `source`, `detail` to group the trials of one experiment invocation. `batch_id` is not a key (see `docs/normalization.md` §6).
16. (Phase 4) A cross-process **MySQL named lock** (`GET_LOCK('playsync.lab', 0)`, `server/src/lab/labLock.ts`) replaces the in-process `running` flag, so the CLI bench, the test suite and the UI can't clash on the shared lab accounts.
17. (Phase 4) Lost-update `lost` is defined as `succeeded − finalCount` (increments that **reported success** but are missing from the counter), not PLAN §8.2's `N − final`: a CAS worker that exhausts its retries counts as an error, not a lost update.
18. (Phase 4) The full-control lab (PLAN §7 item 3) lives in Stats for nerds as a **"Lab"** tab; the old "Stress data" tab is renamed **"Experiment runs"** (`?tab=runs`, `?tab=stress` still works) and now reads `GET /api/lab/runs` instead of the browser's local trace.
19. (Phase 4) `POST /lab/race` (the friendly page's single-trial endpoint) now returns `runId`/`batchId`/`trial` fields too (it's implemented as `runStreamLimitExperiment({..., trials: 1})`); it accepts an optional `batchId` in the body so "Compare all" groups its six calls under one batch.
20. (Phase 4) The CAS lost-update variant caps retries at 500 attempts and then reports an `error`, not an infinite loop; this is why `lost` is defined via `succeeded − finalCount` rather than `N − final` (see deviation 17).
21. (Phase 4) The CLI bench prints one progress line per **trial**, but because `runStreamLimitExperiment`/`runLostUpdateExperiment` return only after all trials of one matrix cell finish, all of a cell's lines print together when that cell completes, not truly streamed one at a time. The numbers are per-trial and correct either way.

22. (Phase 5) The stepper uses its own named lock `playsync.stepper` (separate from `playsync.lab`), held only around `load`/`reset` DB setup. It never touches the CONSTRAINT unique index (no scenario needs it), so the plan's "ensure index absent / restore" step was skipped.
23. (Phase 5) 8 scenarios: ORDERED_LOCKING is its own selectable scenario. OPTIMISTIC_CAS steps show a `{v}` placeholder until they run (the value comes from that transaction's own earlier read); the resolved SQL is shown afterwards.
24. (Phase 5) The lease reaper now also skips the stepper accounts `step_a`/`step_b` (like lab accounts), otherwise their 15 s sessions were expired before the stepper's invariant panel could show the violation.
25. (Phase 5) `load()`/`reset()` first end any open transaction (ROLLBACK, or KILL + reconnect if a step is still WAITING) and bump a generation counter so a stale in-flight step cannot write into the new scenario. Without this, loading a scenario on top of one holding row locks hung (BUSY).
26. (Phase 5) Extra endpoint `GET /lab/stepper/invariant`; a transaction refuses a new Step while its previous step is still WAITING (`busy`).
27. The UI was redesigned dark (zinc + translucent whites, anime.js v4) by another contributor. The Tailwind `stone` scale is remapped for dark in `web/src/index.css` so the nerds/stress components keep working; do not use `stone-900/950` as a dark background (use `bg-black/40`). `useAnime` creates its scope lazily (a mount-only scope left cards at opacity 0 when the ref attached after a Loading branch).

Record any new deviation you make in this list, and in your phase summary.

28. (UI) The page-entry animation is a CSS keyframe with fill `backwards`: a forwards-filling `transform` animation keeps a containing block alive for `position: fixed` descendants (this misplaced the chapter rail). Overlays also use portals.
29. (NAV) anime.js `onScroll` was not adopted; a shared scroll bus plus a paused timeline scrubbed with `seek()` is used (supports reverse scrubbing and clean teardown).
30. (SIM) Simulation M3 was built inside the story chapters; the `phase-sim.md` §5.1 layout and the M4 phone Relay bottom sheet are superseded. `GET /lab/sim/state` also returns `seriesAll`. Household/device names are generated on the server; BURST arrival repeats as a wave every 6 s. Isolation is passed to TXN_RR only (passing it to the others silently weakened SERIALIZABLE).
31. (NAV) Watermelon Dock/FluidTabs (and the unused DialogStack/Feedback) were deleted; the shell no longer uses them. All range inputs use the vendored, restyled Adaptive Slider.
32. `experiment_run.source` gained `SIM` (schema change: `npm run db:reset`, or `ALTER TABLE experiment_run MODIFY source ENUM('UI','API','BENCH','TEST','SIM') NOT NULL DEFAULT 'API'`).
33. (Phase 6) The index experiment is a Stats for nerds tab ("Index"), not a `/index-lab` page. It drops and restores `ix_session_account_status_lease` (and `ix_session_status_lease` for the third setup) under the lab lock and always restores them.
34. (Phase 7) `TRIGGER` and `REDIS_LEASE` are strategies 7 and 8. The trigger and unique index are managed only through `prepareForStrategy(conn, name)` (`strategies/artifacts.ts`); every call site that used `setUniqueIndex` now uses it. Measured against the plan's hypothesis: the trigger is *mostly* safe, not "racing like NAIVE" (a `SELECT` in a trigger takes locking-read locks); REDIS_LEASE TAKEOVER needs a post-commit reconciliation because Redis admission and MySQL preemption are two stores. Redis runs in docker-compose (port 6380); nothing touches it unless that strategy is used (`redisInUse()` guards the heartbeat/release hooks).
35. (Phase 7) The Theory tab (precedence graph, basic TO, TO + Thomas write rule) is client-only pure TypeScript; it is a *simulation* (MySQL doesn't use timestamp ordering).

## 7. How to work here

- **One phase at a time.** Create the phase branch from the current one (`git checkout -b phase-4` from `phase-3`). Follow the phase plan in `docs/implementation/`. At the end: all tests green, typecheck clean, build OK, browser-verified. Then **stop** and report: what you built, the commands to verify it, and any deviations.
- **Commit only when the user asks.** Use their attribution conventions. Never commit `COPILOT_TASK.md` / `COPILOT_FOLLOWUP.md` (scratch files, untracked on purpose).
- **Dev servers:** the user often runs `npm run dev` in their own terminal. Before starting one, check `lsof -iTCP:4000 -iTCP:5173 -sTCP:LISTEN`. If one is running, use it (tsx watch reloads the server on save; Vite hot-reloads the web). **Never kill processes you didn't start.** The in-app browser preview config is `../.claude/launch.json` (name `playsync`).
- **After a schema change:** update `db/schema.sql`, run `npm run db:reset`, and update `docs/normalization.md` / `docs/er.md` if keys or FDs changed. Restart the dev server afterwards; the pools reconnect, but the live strategy's unique index state resets.
- **Verify in the browser**, not just with tests: desktop and 375 px width, no console errors. The browser logs expected 409/410 responses as "Failed to load resource"; those are fine.
- Keep strategies small and commented with the anomaly they allow or prevent; they are shown in a viva.
- Report outcomes faithfully. If a test is flaky, find the cause; don't just retry it.

## 8. Known gotchas

- Tests share lab accounts with the running dev server. Running `npm test` or `npm run bench` while clicking around the Stress test page can make both produce confusing numbers. The Phase 4 cross-process lab lock fixes this.
- `labPool` is 120 connections and MySQL `max_connections` is 300. Lab concurrency must stay ≤ `LAB_POOL_SIZE`, and ≤ 64 × accounts (devices per lab account).
- SERIALIZABLE and OPTIMISTIC at high contention in TAKEOVER mode **legitimately** exhaust `withRetry`'s 5 retries for some requests (reported as `errors`). That is a finding, not a bug.
- Changing `LEASE_MS` changes how long the "offline" demos take (lease 15 s + reaper 2 s).
- JSON columns come back from mysql2 already parsed (objects, not strings).
- **SERIALIZABLE gets WORSE, not better, when load is spread over more accounts** (16 accounts vs. 1, same total concurrency): in a quick bench run, mean p95 at concurrency 32 went from ~47ms (1 account) to ~359ms (16 accounts), with retries roughly quadrupling. This is a real, reproducible InnoDB effect, not a bug: `SELECT COUNT(*) WHERE account_id = ?` under SERIALIZABLE takes a shared next-key lock on `ix_session_account_status_lease`, and next-key locks extend into the gap toward the *next* distinct key value in the index — so one account's phantom-protection range can abut (and, depending on row distribution, effectively serialize against) a neighboring account's inserts on the same physical index. This is worth citing directly in `docs/concurrency.md` (Phase 6) alongside H6 (index footprint); don't try to "fix" it by changing the query, since demonstrating this exact interaction between locks and index layout is the point.


## UI phase (branch `phase-ui`; light/dark replaced deviation 27's dark-only theme)

Friendly light/dark redesign: theme tokens in `web/src/index.css` (`stone-*`, `fg/N`, `violet` = coral brand), Melo mascot (`components/Mascot.tsx`), device avatars, anime.js presets (`lib/motion.ts`, reduced-motion safe), vendored Watermelon components in `components/watermelon/` (see its README; uses `motion`), toasts (`lib/toast.tsx`), theme toggle (`lib/theme.tsx`), routes lazy-loaded. Voice and theme rules: `docs/ui-voice.md`. Plan: `docs/implementation/phase-ui-playful.md`. This supersedes deviation 27's "dark only" redesign. `/sim` should reuse the mascot, `Verdict`, `RaceTrack` and motion presets.
