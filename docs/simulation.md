# Simulation control room: design, metrics and limits

`/sim` runs a crowd of virtual listeners against the real database and lets you change the conditions while it runs. Every press of Play is a real transaction through `executeClaim` and the strategies; nothing is faked on the client. Plan: [implementation/phase-sim.md](implementation/phase-sim.md); how it is presented (chapter story): [implementation/phase-nav-ux.md](implementation/phase-nav-ux.md) §8.3.

## How a run works

- **Server** (`server/src/lab/sim/`): `engine.ts` (singleton; holds the `playsync.lab` named lock for the whole run), `config.ts` (caps, presets, live-field whitelist), `device.ts` (virtual device), `truth.ts` (ground-truth query and repair), `metrics.ts`, `names.ts`, `emitter.ts` (socket room `sim`). API in `server/src/routes/sim.ts`.
- **Devices are timestamps, not timers.** One 100 ms loop steps every device (cool-down, heartbeat, release), schedules arrivals, runs the expire sweep (1 s), the ground-truth query (500 ms) and emits a tick (250 ms; device *diffs* only; `seq` guarded on the client).
- **Arrivals:** BURST = a wave of all idle devices every 6 s; STEADY = Poisson per household at `ratePerSec`; RUSH = the rate ramps from 10% to 100% over the run.
- **Claims** use `labPool` connections (pool wait is measured as part of time-to-play, so starvation is visible). The strategy is read per press, so a live switch affects new presses only. Any of the eight strategies can be used (REDIS_LEASE needs Redis; the lab and simulation flush its slot keys on reset).
- **Leases** are `leaseSec`. Heartbeats go through `playback.heartbeat` (fenced). Devices that go "offline" stop heartbeating; the simulation's own sweep (`reapAccount`, exported from the reaper) expires them because the global reaper deliberately skips lab accounts.
- **Teardown** (always, in `finally`, also on server shutdown): end every session on the simulation's accounts, restore each account's original `max_streams`, restore the unique index/trigger for the live strategy (`prepareForStrategy`), release the lab lock, persist one `experiment_run` row (`source = 'SIM'`, `detail` = config + summary + timeline markers + a series of at most 180 points).

## Ground truth

`readTruth()` counts, per simulation account, sessions with `status = 'PLAYING' AND lease_expires_at > NOW(3)` against `max_streams`, straight from SQL. Client counters are never used for correctness.

## Metric definitions

| Metric | Definition |
|---|---|
| households over limit | accounts with `active > max_streams` at the last ground-truth read |
| newViolationEvents | transitions from within-limit to over-limit (must stop rising after a safe strategy is switched on) |
| peakExcess | largest `active - max_streams` seen in the run |
| violationSeconds | sum over ticks of (households over limit x elapsed seconds) |
| time to play | queue wait + transaction time (including retries) + simulated network lag |
| p50 / p95 | percentiles of time to play; the live tile uses the last 10 s, the summary the whole run |
| happiness | share of presses that ended in PLAYING, or in a correct rejection within 1000 ms (honest, fast feedback counts as happy) |
| plays/s | songs started in the last 5 s |
| retries / deadlocks / timeouts | counted from `withRetry`: errors 1213, 1205 and OCC conflicts |

## Design decisions worth knowing

- **Existing damage persists.** Switching from NAIVE to a safe strategy stops *new* violations; sessions already over the limit stay until they end. *Repair now* is a separate, explicit transaction per violating household (account row locked first, newest excess sessions ended, `RELEASED` events with `by: 'repair'`). Prevention and repair are different jobs.
- **Two delays.** Server hesitation (0-50 ms) sleeps inside the transaction between check and write, widening the race window. Network lag (0-500 ms) sleeps outside it: it hurts experience, never correctness.
- **Isolation** is only applied to the "Transaction, no locks" strategy; applying it to the others silently weakens them (this caused a real false violation during development).
- **Show the database** overlay: strategy and isolation, live lock waits (`data_lock_waits`), deadlocks, lock timeouts, claims in flight, retries, and a per-strategy SQL sketch (a sketch, not a capture: the simulation calls the service layer directly, so nothing is traced), plus a link into the Stepper with the matching scenario.
- **Teaching point in the numbers:** at 16 households x 32 devices, SERIALIZABLE is correct but the overlay shows thousands of deadlocks and a much higher p95; this is why "Strict but slow" exists.

## Known limits

- One run at a time (lab lock); `/stress`, the bench and lab tests get 409 while it runs.
- Up to 1,024 virtual devices (16 x 64); the UI switches to a heatmap above 128.
- Lab accounts only; `brij`, `step_a`, `step_b` are never touched.
- Event ring buffer keeps the last 200 events; the persisted series is downsampled to 180 points.
