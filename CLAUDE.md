# PlaySync: guide for coding agents

Read this file completely before touching code. It tells you what the project is, what is already built, the rules the code follows, and how to work here. The original specification is [docs/PLAN.md](docs/PLAN.md). Where this file and PLAN.md disagree, **this file wins**: the differences are deliberate decisions made during Phases 0–3 (see "Deviations from PLAN.md").

## 1. What this project is

A DBMS coursework project. A tiny music app where one account has several devices (MacBook, iPhone, iPad, Browser) and may play on at most `max_streams` of them at once. The app is a **concurrency-control lab**: it protects one invariant and measures how six strategies protect it (or fail to) on a real MySQL/InnoDB database.

> **Invariant:** for every account, the number of sessions with `status = 'PLAYING'` and `lease_expires_at > NOW(3)` is ≤ `account.max_streams`.

The two-devices-press-Play race is **write skew / a phantom**, not a lost update. Lost update gets its own experiment (the song play counter, Phase 4).

## 2. Status

| Phase | What | State | Branch |
|---|---|---|---|
| 0 | Scaffold, Docker MySQL, health endpoint | ✅ done | `main` |
| 1 | Schema, seed, ER + normalization docs | ✅ done | `main` |
| 2 | Six strategies, playback service, REST API | ✅ done | `phase-2` |
| 3 | Real-time sync, lease reaper, friendly UI + Stats for nerds | ✅ done | `phase-3` (current) |
| 4 | Concurrency Lab: trials, persistence, lost update, bench | **next**. Plan: [docs/implementation/phase-4.md](docs/implementation/phase-4.md) | `phase-4` |
| 5 | Transaction Stepper | planned: [docs/implementation/phases-5-7.md](docs/implementation/phases-5-7.md) | `phase-5` |
| 6 | Index lab + report docs | planned (same file) | `phase-6` |
| 7 | Stretch goals, **only if the user asks** | planned (same file) | — |

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
npm run bench              # CLI experiment matrix (implemented in Phase 4)
```

Baseline at the end of Phase 3: **105 server tests pass (2 skipped by design) + 3 web tests**, typecheck clean, build succeeds. Keep it that way: never finish a step with a red suite.

## 4. Repository map

```
db/schema.sql, db/seed.sql     Loaded only when the Docker volume is created → schema changes need `npm run db:reset`.
docs/PLAN.md                   Original spec.  docs/er.md, docs/normalization.md: Phase 1 report material.
docs/implementation/           Phase plans for agents (this handoff).
scripts/bench.ts               Stub until Phase 4.

server/src/
  config.ts                    zod-parsed env from ../.env (LEASE_MS 15000, HEARTBEAT_MS 5000, REAPER_MS 2000, pools 20/120).
  app.ts / index.ts            createApp() (used by supertest) / listen + socket.io + reaper + startup setLiveStrategy().
  db/pool.ts                   appPool (live app), labPool (experiments; must be ≥ max lab concurrency).
  db/tx.ts                     withTx(conn, isolation, fn), withRetry(fn, stats) (1213, 1205, OccConflictError), OccConflictError, sleep.
  db/errors.ts                 errno helpers (1062 dup, 1205 timeout, 1213 deadlock, 1452 FK).
  strategies/                  types.ts, common.ts (shared statements, grant/reject), one file per strategy, index.ts (registry + executeClaim = idempotency wrapper).
  services/playback.ts         claim (policy handling), heartbeat (fencing, 410), pause/release, settings, endAll, live strategy switch.
  services/accountState.ts     bumpVersion(), readSnapshot() (consistent READ ONLY snapshot).
  services/leaseReaper.ts      reapOnce(), startReaper(ms). Skips lab accounts.
  services/checks.ts           Six live SQL assertions per account (GET /api/accounts/:id/checks).
  realtime/                    presence.ts (online set), publisher.ts (publish-after-commit interface), socket.ts (rooms, join, pushes).
  lab/raceRunner.ts            Single-trial STREAM_LIMIT race (Phase 4 extends it).  lab/invariant.ts: the invariant query.
  routes/                      health, info (read-only UI endpoints + checks), accounts (state/settings/end-all/hello/admin strategy), playback, lab, http.ts (asyncHandler + error mapping).
server/test/                   One file per area; helpers.ts has resetAccount(), deviceIds(), expireLease(), count()...

web/src/
  lib/api.ts                   Typed fetch wrapper; returns {ok,status,body}, never throws on 4xx; records every non-GET call in the trace.
  lib/trace.ts                 Action trace (localStorage, shared across tabs) + summarize() for each endpoint.
  lib/socket.ts                useAccountState({accountId, deviceId?, enabled?, onSessionLost?}): one socket per caller; leaseRemaining().
  lib/versionedStore.ts        Drops snapshots with a LOWER stateVersion (equal is accepted).
  lib/useDeviceSession.ts      All device-client behaviour (claim, heartbeats, offline, adoption after reload, session_lost).
  components/ui.tsx            Card, Badge, Button, Dot, Equalizer, Stat, Field, inputCls, Code, Segmented, cx. Use these.
  components/device/           DeviceCard, NowPlaying, PlayerControls, deviceMessages (plain-language messages).
  components/nerds/            One file per Stats-for-nerds tab.
  pages/                       HomePage, DevicesPage (/devices), DevicePage (/device?account=&device=), StressTestPage (/stress), NerdsPage (/nerds?tab=...).
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
- Light theme: stone background, white rounded-2xl cards, violet primary, emerald = playing/success, rose = failure, amber = warning, sky = offline. Reuse `components/ui.tsx`.
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

Record any new deviation you make in this list, and in your phase summary.

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
