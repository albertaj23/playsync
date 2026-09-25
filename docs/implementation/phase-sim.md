# PlaySync — Phase 5.5: Simulation Control Room

> **Status update (2026-09-25): built (M1–M4).** Presentation deviates: the `/sim` layout became a six-chapter story (see `docs/implementation/phase-nav-ux.md` §8.3), and the phone Relay bottom sheet was dropped. Design, metrics and limits: `docs/simulation.md`.

Plan for Claude Code. Save as `docs/implementation/phase-sim.md` and read it together with `CLAUDE.md`, `docs/PLAN.md`, `docs/implementation/phase-4.md` and `docs/implementation/phases-5-7.md`.

## 0. Goal in one paragraph

Add a presenter-grade page, `/sim`, where the demonstrator sets system conditions on a control panel (the **Relay**) and then watches a crowd of simulated listeners use PlaySync in real time (the **Stage**).

Every simulated press of Play is a **real transaction** through the existing playback service and strategies. Nothing is faked on the client. Every violation shown comes from a live SQL invariant query, not from client counters.

The signature demo moment is:

1. Load the "Break it" preset.
2. Watch households go over their stream limit while the violation counter climbs.
3. Switch protection mid-run.
4. Watch new violations stop within one tick while listener experience metrics shift.

## 1. Preconditions (do these first, then stop and report)

1. **Finish the open Phase 5 bug.** The stepper invariant panel shows "holds" because the lease reaper expires `step_a`/`step_b` sessions.
   - Make the reaper skip stepper accounts (option (a) in the handoff).
   - Add a reaper test.
   - Record the change in `CLAUDE.md` §6.
2. **Complete the remaining Phase 5 checklist** from the handoff: browser verification, `CLAUDE.md` and `README` updates, and test counts. Commit only when the user asks.
3. **Create branch `phase-sim` from `phase-5`** after the user approves the Phase 5 commit.
4. **Read before coding, and adapt names to what actually exists. Do not assume the names in this plan.**
   - `server/src/lab/raceRunner.ts`, for the barrier/burst start and the check-to-insert delay parameter.
   - `server/src/services/playback.ts`, for claim/heartbeat/release, policies and the live strategy switch.
   - `server/src/services/leaseReaper.ts`, for the expire SQL.
   - `server/src/lab/labLock.ts`, `lab/persist.ts` and `lab/stats.ts`.
   - Fault injection (`AFTER_SESSION_INSERT`).
   - `server/src/realtime/*` and the web `VersionedStore`.
   - Check whether a chart library is already in `web/package.json`. If none is present, draw charts with plain SVG rather than adding a heavy dependency.

## 2. Hard rules carried over from the project

- Raw parameterized SQL only, with no ORM. Follow the global lock order `account -> device -> playback_session -> playback_event`.
- Publish to sockets only **after COMMIT**.
- The simulator takes the named lock `playsync.lab` for the whole run. While a simulation runs, `/stress`, the bench and lab tests get `409 BUSY`, and vice versa. Surface this in the UI as "Another experiment is running."
- The simulator uses the lab accounts (`lab_01..lab_16`, up to 64 devices each) and never touches `brij`, `step_a` or `step_b`.
- **Two-audience rule.** `/sim` is a presenter page.
  - By default it uses friendly language: no ids, HTTP codes, lease timestamps or strategy identifiers.
  - A **"Show the database"** toggle opens a technical overlay where everything technical is allowed.
  - Record this as a deviation in `CLAUDE.md` §6.
- Keep React components under about 200 lines each, split into several files. Long single-file visual components previously tripped the tool classifier.
- Stop and report at the end of every milestone. Commit only on request, with the usual `Co-Authored-By` trailer.

## 3. The Relay: system conditions

Validate every field with the project's existing validation approach, using hard caps. Fields marked **live** can change while a simulation runs; the rest need a restart.

| Friendly label | Config field | Range / values | Live? |
|---|---|---|---|
| Protection | `strategy` | 6 strategies (friendly names below) | **live** |
| Screens allowed per household | `maxStreams` | 1–4 | no |
| Households | `accounts` | 1–16 | no |
| Devices per household | `devicesPerAccount` | 2–64 | no |
| How people press Play | `arrival` | `BURST` (all at once), `STEADY` (Poisson), `RUSH` (linear ramp) | no |
| Play presses per second (per household) | `ratePerSec` | 0.2–20 (STEADY/RUSH only) | **live** |
| Server hesitation | `checkDelayMs` | 0–50 ms between the count and the insert, inside the transaction | **live** |
| Network lag | `jitterMs` | 0–500 ms of client-side sleep before and after each call, outside the transaction | **live** |
| Flaky devices | `offlinePct` | 0–50% of playing devices stop heartbeating | **live** |
| How long a play "ticket" lasts | `leaseSec` | 5–60 s | no |
| When the limit is reached | `policy` | `REJECT`, `TAKEOVER`, `ASK` (auto-answered "yes" with probability `askYesPct`) | no |
| Crash mid-play | `crashPct` | 0–20% probability of the `AFTER_SESSION_INSERT` fault | **live** |
| Isolation (only for the "transaction, no locks" strategy) | `isolation` | `READ COMMITTED`, `REPEATABLE READ` | no |
| Run length | `durationSec` | 10–180 s | no |
| Listening time | `listenSec` | min–max range, 3–30 s | no |

The UI must explain the difference between the two delay controls. "Server hesitation" holds the transaction open, which widens the race window. "Network lag" does not, so it hurts experience but not correctness. That contrast is itself a teaching point.

### Friendly strategy names

The default view uses the friendly name. The technical overlay shows the strategy identifier.

| Strategy | Friendly name |
|---|---|
| NAIVE | No protection |
| TXN_RR | Transaction, no locks |
| SERIALIZABLE | Strictest isolation |
| PESSIMISTIC | Lock, then check |
| OPTIMISTIC | Check, then retry on conflict |
| CONSTRAINT | Reserve a numbered slot |

### Presets

Presets appear as big buttons above the Relay, each with a one-line story.

| Preset | Story | Key settings |
|---|---|---|
| Break it | "Everyone hits Play at the same second, and nobody is guarding the door." | NAIVE, BURST, 1 household, 32 devices, limit 1, hesitation 20 ms |
| Family fight | "Four people, one screen, all evening." | PESSIMISTIC, STEADY, 1 household, 4 devices, limit 1, TAKEOVER |
| Release-night rush | "A new album drops; traffic ramps to peak." | OPTIMISTIC, RUSH, 16 households, 32 devices, limit 2 |
| Flaky Wi-Fi | "Phones fall asleep mid-song; tickets must expire." | PESSIMISTIC, STEADY, `offlinePct` 30, `leaseSec` 8 |
| Crash mid-play | "The server dies halfway through starting a song." | PESSIMISTIC, `crashPct` 15 |
| Strict but slow | "Perfectly safe, but are listeners happy?" | SERIALIZABLE, BURST, 16 households, 32 devices |

## 4. Server design: `server/src/lab/sim/`

### 4.1 Files

- **`types.ts`**: `SimConfig`, `SimPhase` (`IDLE | STARTING | RUNNING | PAUSED | STOPPING | DONE`), `VDeviceState`, `SimTick`, `SimEvent`, `SimSummary`.
- **`config.ts`**: caps, defaults, presets, validation, and the list of live-changeable fields.
- **`engine.ts`**: `SimEngine` singleton, following the stepper engine's pattern.
- **`device.ts`**: the virtual-device state machine and its async loop.
- **`arrival.ts`**: schedules for BURST (barrier, reusing the raceRunner approach), STEADY (exponential inter-arrival) and RUSH (ramped rate).
- **`metrics.ts`**: rolling one-second windows, a latency histogram with fixed buckets, outcome counters and a happiness calculation.
- **`invariant.ts`**: the ground-truth query and the sim-local lease sweep.
- **`emitter.ts`**: pushes to socket room `sim`, with a no-op default, wired like the stepper emitter.

### 4.2 Virtual device lifecycle

```
IDLE -> PRESSING (claim in flight) -> PLAYING -> (listen time) -> RELEASING -> IDLE
                    |-> REJECTED (limit reached)            -> cool-down -> IDLE
                    |-> RETRYING (OCC conflict, 1213/1205)  -> PRESSING
                    |-> FAILED (retries exhausted / crash)  -> cool-down -> IDLE
PLAYING -> MOVED  (410 fencing: another device took over)   -> IDLE
PLAYING -> OFFLINE (stops heartbeating)                     -> lease expires -> IDLE
```

- Call the playback **service layer directly**, not HTTP. Use the same code path and the same `executeClaim` idempotency wrapper as the REST route.
- A playing device heartbeats every `leaseSec/3` with fencing.
- An OFFLINE device stops heartbeating. Because `leaseReaper` skips lab accounts, `invariant.ts` must run its own expire sweep for the simulation's accounts every second. Reuse the reaper's SQL with an account filter; do not change the global reaper's skip rule.
- Record per-press timing split into three parts:
  - `queueMs`: waiting for a connection slot.
  - `dbMs`: the transaction including retries.
  - `jitterMs`: the simulated network lag.
- "Time to start playing" is the sum of the three.

### 4.3 Concurrency and resources

- Cap in-flight claims with a semaphore at `min(labPool size, 120)`. Measure queue time separately, so pool starvation is visible rather than hidden.
- Device loops are cheap timers. Up to 1,024 virtual devices must not create 1,024 connections.
- On `stop`, finish in-flight claims, release every session held by the simulation's accounts, and restore the accounts' original `max_streams` and the original strategy.

This teardown runs in a `finally` block together with releasing the named lock. It must also run on server shutdown, so hook it into the `index.ts` shutdown the same way as the stepper engine.

### 4.4 Ground truth and metrics (per tick, every 500 ms)

The invariant query, over the simulation's accounts only:

```sql
SELECT a.id, a.max_streams,
       COUNT(s.id) AS active
FROM account a
LEFT JOIN playback_session s
  ON s.account_id = a.id
 AND s.status = 'PLAYING'
 AND s.lease_expires_at > NOW(3)
WHERE a.id IN (?)
GROUP BY a.id, a.max_streams;
```

From this, derive the following metrics:

- **`violatingHouseholds`**: households where `active > max_streams` right now.
- **`peakExcess`**: the largest excess seen in the run.
- **`violationSeconds`**: summed time spent over the limit.
- **`newViolationEvents`**: count of transitions from within-limit to over-limit. This is the counter that must stop rising after switching to a safe strategy.

Also track, per one-second window:

- Presses, successes, rejections, moves, retries, deadlocks (1213), lock-wait timeouts (1205) and failures.
- p50 and p95 time-to-play.
- Throughput.
- **Listener happiness**: the percentage of presses that ended in PLAYING or a correct, fast REJECT within 1,000 ms. A correct rejection counts as a happy outcome, because it is honest feedback.

Stop the tick timer before running the teardown.

### 4.5 Important teaching behaviour: existing damage persists

Switching from NAIVE to a safe strategy stops **new** violations, but sessions already over the limit stay until they end. **Do not silently repair them.** Instead:

- Add a Relay button, **"Repair now"**. It runs one transaction per violating household, following the lock order: lock the account row, then end the newest excess sessions and write `playback_event` rows.
- Show the repair as its own event in the feed.

This demonstrates that concurrency bugs corrupt data, and that prevention and repair are different jobs.

### 4.6 Events and socket payloads

- **`sim_tick`** (every 250 ms). It carries `seq`, `phase`, `elapsedMs`, current config, KPIs, per-household `{active, max}`, and only the device-state **diffs** since the last tick. The client drops ticks with a lower `seq`.
- **`sim_event`**. Notable events: rejections, moves, crashes, violations appearing or clearing, strategy switches, repairs. Keep them in a server ring buffer of 200 and send them batched inside the tick. Each event carries both a friendly `message` and a `tech` object for the overlay.
- **`sim_done`**. The final `SimSummary`.

### 4.7 Persistence

At the end of every run, write one `experiment_run` row with:

- `source = 'sim'` and a fresh `batch_id`.
- `wall_ms`.
- `detail` JSON containing the config, summary, strategy-switch timeline and a downsampled KPI series (at most 180 points).

It must then appear in the existing nerds "Experiment runs" tab without changes to that tab. If a small change is needed, keep it minimal.

### 4.8 API: `server/src/routes/sim.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/lab/sim/presets` | Presets and caps |
| GET | `/lab/sim/state` | Full snapshot, for reloads and late joiners |
| POST | `/lab/sim/start` | Body: `SimConfig`; returns 409 BUSY if the lab lock is held |
| POST | `/lab/sim/pause` / `/lab/sim/resume` | Pause stops new presses but keeps heartbeats going |
| POST | `/lab/sim/stop` | Graceful teardown |
| PATCH | `/lab/sim/config` | Live fields only; rejects others with a clear message |
| POST | `/lab/sim/repair` | Section 4.5 |
| GET | `/lab/sim/runs/:batchId` | Stored summary, used for the compare view |

## 5. Web design: `/sim`

### 5.1 Layout (desktop)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Presets: [Break it] [Family fight] [Release-night rush] [Flaky Wi-Fi]│
├──────────────┬───────────────────────────────────────┬───────────────┤
│  RELAY       │  STAGE                                │  FEED         │
│  (controls,  │  household cards, each a device grid  │  phone-style  │
│  Start/Pause │  with a "2 / 2 screens" meter          │  notification │
│  Stop/Repair)│                                       │  stream       │
├──────────────┴───────────────────────────────────────┴───────────────┤
│ PULSE: Violations (big) | Happiness % | Time-to-play p95 | Plays/s   │
│        timeline chart with vertical markers at strategy switches     │
└──────────────────────────────────────────────────────────────────────┘
                              [ Show the database ▸ ]  (technical overlay)
```

At 375 px width, stack the sections as Presets, Pulse, Stage and Feed. The Relay becomes a bottom sheet. There must be no horizontal scroll.

### 5.2 Files: `web/src/components/sim/`

`SimPage.tsx` (route shell), `PresetBar.tsx`, `RelayPanel.tsx` (split into `RelayConditions.tsx` and `RelayRunControls.tsx`), `HouseholdGrid.tsx`, `HouseholdCard.tsx`, `DeviceTile.tsx`, `LimitMeter.tsx`, `FeedbackFeed.tsx`, `PulseStrip.tsx`, `TimelineChart.tsx`, `RunSummary.tsx`, `CompareRuns.tsx`, `DatabaseOverlay.tsx`.

Also add `web/src/lib/sim.ts` (types, API calls and friendly copy) and `useSimUpdates` in `lib/socket.ts`, which joins the `sim` room and uses a `seq`-guarded reducer.

### 5.3 Visual language

| State | Tile look | Friendly feed message example |
|---|---|---|
| Idle | Muted outline | — |
| Pressing | Amber pulse; after 1 s shows "Still connecting…" | — |
| Playing | Green with animated equalizer bars and song title | "Meera's iPad is playing *Low Tide Letters*" |
| Rejected | Gray with a brief shake | "Arjun's iPhone: 2 screens are already playing in this household" |
| Moved | Blue fade | "Playback moved from the MacBook to the iPad" |
| Retrying | Amber with a small counter | — (overlay only) |
| Offline | Dimmed, with a sleeping icon | "The Browser went to sleep; its spot opens up in a few seconds" |
| Failed / crash | Striped red | "Something went wrong starting the song — nothing was charged to the household" |

**Over-limit household:** the card gets a red border, the meter reads "3 / 2 screens", and a badge says "More screens than allowed". This is the violation made visible from the listener's point of view.

Further requirements:

- Respect `prefers-reduced-motion`.
- Generate household and device display names deterministically on the client. Use made-up family names, like "The Iyer household", and device names from the existing device-name list.
- Past about 128 visible devices, switch the Stage to a compact heatmap mode: one small square per device, colored by state. Keep full tiles below that threshold.

### 5.4 Pulse and summary

- The violations counter is the largest element on the page. It stays green at 0 and turns red with a count-up animation when it rises.
- The timeline plots plays/s, p95 time-to-play and violating households over time, with labelled vertical markers at every live change such as "Protection → Lock, then check".
- **RunSummary** appears when a run ends. It shows the verdict ("Limit held" or "Limit broken N times, peak X over"), happiness, p95, throughput and retries. A **"Compare with…"** control picks any earlier simulation run and shows the two side by side.

### 5.5 "Show the database" overlay

The overlay shows:

- The strategy identifier and isolation level.
- The SQL of the last completed claim, taken from the existing trace mechanism where possible.
- Live counts of lock waits (from `performance_schema.data_lock_waits`) and deadlocks.
- The pool queue depth.
- A link, "Why did this happen?", that opens `/nerds?tab=stepper` with the matching scenario preselected. Examples: "Break it" → `RACE_TXN_RR`; "Strict but slow" → `SERIALIZABLE_DEADLOCK`.

### 5.6 Navigation

Link to the page from Home with one friendly sentence, and from the nerds page header. Add `/sim` to the page list in the README.

## 6. Tests

### Server: `server/test/sim.test.ts`

Mark these tests slow, like `lab.test.ts`, so `test:fast` skips them.

1. Config validation rejects over-cap and non-live PATCH fields.
2. BURST + NAIVE + 1 account + 8 devices + limit 1 + 20 ms hesitation gives at least one ground-truth violation.
3. The same config with PESSIMISTIC, OPTIMISTIC, CONSTRAINT and SERIALIZABLE gives 0 violations.
4. A live strategy switch from NAIVE to PESSIMISTIC means no new violation events after the switch tick. Allow one tick of in-flight claims, and document that allowance.
5. `crashPct = 100` for a short run leaves no orphan sessions and no half-written events (checks atomicity).
6. `offlinePct = 100` with a 5 s lease means sessions expire through the sim sweep, and the global reaper's skip rule is unchanged.
7. Repair returns every household to within its limit and writes events.
8. Stop and shutdown release `playsync.lab`, restore `max_streams` and the strategy, and leave no PLAYING sessions on the simulation's accounts.
9. A finished run writes an `experiment_run` row with `source = 'sim'`.
10. Start during a held lab lock returns 409 BUSY.

### Web

Write reducer tests for `seq` ordering, diff merging and event batching.

### Browser verification checklist

- Run every preset once.
- Test a live switch mid-run, Repair, and Pause/Resume.
- Reload mid-run: the state is restored from `GET /state`.
- Open two browser tabs: both stay in sync.
- Check the 375 px layout.
- Check the console for errors. The known expected 409/410 resource logs are fine.

## 7. Milestones (stop and report after each)

| # | Scope | Done when |
|---|---|---|
| M1 | Server engine, invariant, metrics, API, persistence, tests 1–10 | A simulation runs headless via curl and all tests pass 3 times in a row |
| M2 | Relay + presets + Stage (tiles, meters, over-limit styling) | "Break it" visibly breaks households in the browser |
| M3 | Feed, Pulse, timeline with switch markers, RunSummary, Compare, Repair button | The full "break it → switch → repair" story works live |
| M4 | Database overlay, heatmap mode, 375 px, reduced motion, README demo script, `CLAUDE.md` (status, repo map, deviations), new `docs/simulation.md` (design, metrics definitions, happiness rationale, known limits) | The browser checklist passes and typecheck, build and the full test suite are clean |

## 8. Demo script to add to the README (target 4 minutes on `/sim`)

1. **Family fight.** A friendly start: takeovers and rejections read like a real app.
2. **Break it.** The violation counter climbs, and household cards show "32 / 1 screens".
3. **Switch live.** Change Protection to "Lock, then check". New violations stop at the marker; point out that the existing damage remains.
4. **Repair now.** The cards return to green, which shows that prevention and repair are different jobs.
5. **Strict but slow.** It is safe, but happiness drops and p95 rises. Open "Show the database" to show the deadlocks and lock waits.
6. **Compare.** Put "Strict but slow" next to a "Release-night rush" run on the optimistic strategy.
7. **Why did this happen?** Jump into the Stepper for the step-by-step explanation.

## 9. Out of scope

- No new strategies.
- No schema changes beyond what persistence already supports. If `experiment_run.source` needs a new allowed value, make the smallest migration possible and note it.
- No authentication.
- No real audio playback.
