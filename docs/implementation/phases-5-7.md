# Phases 5–7: implementation plans

Read `CLAUDE.md` first. Finish and report Phase 4 before starting here. Each phase gets its own branch cut from the previous one, and **stops for review** at the end. Phase 5 is specified in the most detail, because it is the most delicate. Phases 6 and 7 are specified to the level needed to start; refine them into a step list like `phase-4.md` before coding.

---

# Phase 5: Transaction Stepper (PLAN.md §8.3)

**Goal:** run two **real** MySQL transactions (T1, T2) statement by statement from the browser. Show the live InnoDB lock table, lock waits (who blocks whom), deadlocks with the victim and InnoDB's own report, and KILL-based rollback.

**Done when:** every scenario below produces its expected outcome, the lock table shown matches each scenario's explanation, and the scenario tests pass.

## Where it lives in the UI

The stepper is inherently technical, so it is a **Stats-for-nerds tab: "Stepper"** (`/nerds?tab=stepper`). Add one friendly sentence on Home ("Watch two database transactions collide, step by step → Stats for nerds"). Do not create a separate friendly page.

## Server

### Engine: `server/src/lab/stepper/engine.ts`
- Three dedicated, **unpooled** connections created with `mysql.createConnection(base options)`:
  - **T1** and **T2**: `SET SESSION innodb_lock_wait_timeout = 30`. Record `SELECT CONNECTION_ID()` for each.
  - **admin**: never inside a transaction. Used for lock inspection, `KILL`, `SHOW ENGINE INNODB STATUS` and scenario resets.
- The state is a singleton (only one stepper session at a time; guard with the Phase 4 **lab lock**, or a separate named lock `playsync.stepper`, so the stepper and the lab can't collide on shared rows).
- **Load a scenario:**
  1. Recreate T1 and T2 if they were killed.
  2. Reset the stepper accounts `step_a` and `step_b`: delete their sessions and events, `state_version = 0`, `max_streams = 1`.
  3. Ensure the unique index is **absent** for all scenarios except any that explicitly need it. Restore it for the live strategy on unload (same rule as the lab).
  4. Set each connection's isolation for its next transaction.
  5. Set each transaction's statement pointer to 0.
- **Step `txn`:**
  1. Send the next statement on that connection **without awaiting it in the HTTP handler**. Race the query promise against a 300 ms timer.
  2. If it finishes first, respond `{ status: 'DONE', rows, affectedRows }`.
  3. Otherwise respond `{ status: 'WAITING' }` and, when the promise settles, emit `stepper_update` over socket.io to the room `stepper` with `DONE` or `ERROR`.
- **Errors** (`1213` deadlock, `1205` lock wait timeout, `1062` duplicate, `2013`/`ER_CONNECTION_KILLED` after a KILL) are results, not crashes. Mark the statement `ERROR` with code and message, and the transaction as rolled back where InnoDB did so (1213 rolls back the whole transaction).
- **On a deadlock:** run `SHOW ENGINE INNODB STATUS` on admin, extract the text between `LATEST DETECTED DEADLOCK` and the next `------------` section header, and include it in the update. `innodb_print_all_deadlocks=ON` also writes deadlocks to the MySQL error log.
- **Kill `txn`:** admin runs `KILL <conn_id>` (the id must come from the engine's own record, never from the request body). InnoDB rolls the transaction back via the undo log. Mark the transaction `KILLED` and recreate the connection lazily.
- **Reset:** roll back both, reload the scenario.

### Lock inspector: `server/src/lab/stepper/locks.ts`
Use the two queries from PLAN §8.3 verbatim (`performance_schema.data_locks` joined to `threads`, filtered on `OBJECT_SCHEMA = 'playsync'`, plus `data_lock_waits`). Map `conn_id` to `T1`/`T2`/`other`. Return:

```ts
{ locks: { txn, table, index, type, mode, status, data }[], waits: { waiting: 'T1'|'T2', blocking: 'T1'|'T2'|'other' }[], cycle: boolean }
```

`cycle` is true when T1 waits for T2 **and** T2 waits for T1. That is a wait-for-graph cycle; InnoDB will pick a victim almost immediately, so the UI may only catch it briefly. That's fine, and the deadlock banner covers it.

### Scenarios: `server/src/lab/stepper/scenarios.ts`
Each scenario is data:

```ts
{ id, title, syllabusRefs: string[], isolation: { T1, T2 }, steps: { T1: string[], T2: string[] }, suggestedOrder: ('T1'|'T2')[], expected: string, explanation: string }
```

Use literal SQL with the stepper account and device ids resolved at load time (look them up by name; don't hard-code ids). Each statement string is what the user sees. They must be real SQL that runs as is.

1. `RACE_TXN_RR`: both at RR: `BEGIN; SELECT COUNT(*) active…; INSERT session…; COMMIT`. Order: T1 count, T2 count, T1 insert, T2 insert, T1 commit, T2 commit. Both commit, so the invariant is violated. The last step runs the invariant query on admin and shows it.
2. `PESSIMISTIC_RC`: both at RC. T1 runs `SELECT … FROM account WHERE account_id = ? FOR UPDATE` (lock table: `X,REC_NOT_GAP` on account PRIMARY). Then T2 runs the same → **WAITING** (wait arrow T2→T1). T1 inserts and commits → T2 unblocks, counts 1, and rejects (the scenario's T2 script ends with a `ROLLBACK`, and the explanation says "rejects").
3. `PESSIMISTIC_RR_PITFALL`: both at RR. T1 does a plain count first (snapshot fixed: 0), then `FOR UPDATE` on account, and **waits** for T2. T2 locks, inserts, commits. T1 gets the lock, counts again (still 0, from its snapshot), inserts → violation despite locking. The explanation must show how RC fixes it: at RC each statement reads fresh.
4. `SERIALIZABLE_DEADLOCK`: both at SERIALIZABLE. Both count (shared next-key locks visible: `S` on `ix_session_account_status_lease` plus the supremum). Both INSERT (`X,INSERT_INTENTION` waiting) → cycle → one gets **1213**. Show the victim and the deadlock text.
5. `OPTIMISTIC_CAS`: both at RC. Both read `state_version = v`. T1: CAS `UPDATE account … WHERE state_version = v` → 1 row, INSERT, COMMIT. T2: CAS → **0 rows** → abort (`ROLLBACK`).
6. `CLASSIC_DEADLOCK` ("family-plan transfer"): T1 locks account A then B; T2 locks B then A → deadlock. **Variant `ORDERED_LOCKING`:** both lock the lower id first → T2 simply waits, no deadlock (prevention by resource ordering).
7. `KILL_RECOVERY`: T1 inserts a session (uncommitted; its locks are visible, and T2's read of that row at RC doesn't see it). Press **Kill T1** → the locks disappear and the row is gone (undo). T2 proceeds.

### Endpoints (`server/src/routes/stepper.ts`)
- `GET /api/lab/stepper/scenarios`
- `POST /api/lab/stepper/load { scenarioId }`
- `POST /api/lab/stepper/step { txn }`
- `POST /api/lab/stepper/kill { txn }`
- `POST /api/lab/stepper/reset`
- `GET /api/lab/stepper/state` (both transactions' statement lists with status and result rows)
- `GET /api/lab/locks`

Validate with zod. Every state-changing call is traced by the web `api` wrapper, so add `summarize()` cases.

### Tests: `server/test/stepper.test.ts`
Drive the engine directly, stepping in each scenario's `suggestedOrder`, and assert the expected outcome:
- (1) the invariant is violated;
- (2) T2 is WAITING until T1 commits, then sees 1;
- (3) violation;
- (4) exactly one of T1/T2 gets errno 1213 and the deadlock text is non-empty;
- (5) T2's CAS affects 0 rows;
- (6) 1213, but `ORDERED_LOCKING` has no error;
- (7) after the kill, the row is absent and `locks` has no T1 entries.

Also: the lock inspector shows `X,REC_NOT_GAP` on `account` in scenario 2. The engine must close its connections in `afterAll`.

## Web: `components/nerds/StepperTab.tsx`
- Scenario picker: title, isolation per transaction, syllabus tags, explanation, and **expected outcome**.
- Two columns T1 | T2. Each has its statements with a status chip (pending / DONE / WAITING (pulsing) / ERROR / KILLED), a **Step** button (disabled while that transaction is waiting or finished), a **Kill** button, and small result tables under DONE statements.
- **Lock table**, polled every 500 ms: txn, table, index, mode, status (GRANTED/WAITING), lock data. Add a legend explaining the modes:
  - `IX` = table-level intention lock (multi-granularity locking);
  - `X,REC_NOT_GAP` = record lock;
  - `S`/`X` = next-key lock;
  - `X,GAP` = gap lock;
  - `X,INSERT_INTENTION`.
  - Note that FK checks take `S,REC_NOT_GAP` on parent rows (device, song).
- **Wait-for graph**: two nodes (T1, T2) as inline SVG, with an arrow for each wait. A cycle turns rose and says "deadlock".
- **Deadlock banner**: the victim plus a collapsible `LATEST DETECTED DEADLOCK` text.
- Listen to `stepper_update` on a socket. A small addition to `lib/socket.ts` is fine; a plain `io()` inside the tab also works, since this isn't an account room.
- Must work at 375 px: the columns stack.

## Stop and report
The same format as Phase 4. Include a screenshot-worthy description of each scenario's outcome.

---

# Phase 6: Index experiment and report docs (PLAN.md §8.4, §10 Phase 6, §12)

## 6a. Index experiment: `server/src/lab/indexExperiment.ts`, nerds tab "Index lab"
1. **Generate history** (idempotent): make sure about **20,000 ENDED sessions** spread over the lab accounts exist. Insert them in one `INSERT … SELECT` with a `WITH RECURSIVE` sequence (like `db/seed.sql`), with statuses `ENDED`, leases in the past, and `strategy = 'HISTORY'`. The lab's per-trial reset deletes lab sessions, so either regenerate before each index run or keep history on accounts the race doesn't use. **Recommended:** regenerate at the start of each index run. Take the lab lock.
2. For each of {**with** `ix_session_account_status_lease`, **without** it}:
   - `EXPLAIN FORMAT=TREE` (or classic `EXPLAIN`) and `EXPLAIN ANALYZE` of the active-count query for one account. Capture type/key/rows, or the tree text.
   - Open a **REPEATABLE READ** transaction on a dedicated connection. Run the CONSTRAINT strategy's expire `UPDATE playback_session SET status='EXPIRED' … WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at <= NOW(3)`. Count this connection's rows in `performance_schema.data_locks` (join `threads` on `PROCESSLIST_ID = CONNECTION_ID()`). **Rollback.**
   - Optional, and compelling: while that transaction is open, try a claim on a *different* lab account from another connection with a 1 s lock wait timeout. Without the index, it blocks (1205); with the index, it succeeds.
3. Drop the index with `ALTER TABLE playback_session DROP INDEX ix_session_account_status_lease`, and **always restore it in `finally`**. The composite FK has its own index, so dropping this one is allowed.
4. Result: rows scanned and locks held, with vs. without, plus the cross-account blocking result. Nerds tab: a two-column comparison. The friendly Home can get one sentence linking to it.
5. Tests: without the index, the lock count is ≫ with it (for example > 10×), and the index exists after the run.

## 6b. Docs (report material, in `docs/`)
- **`concurrency.md`** (the heart of the report):
  - For each strategy: its schedule (as a numbered interleaving of T1/T2 operations), isolation, locks taken (by mode, from the stepper), and the anomaly allowed or prevented.
  - The **OCC correctness argument** (PLAN §6.4 details: every state change bumps the version; heartbeats can't revive leases; so the worst case is a spurious rejection, never a violation).
  - The **lock-order rule** and where CONSTRAINT breaks it.
  - **Conflict-serializability of the NAIVE schedule:** write `r1(C) r2(C) w1(S1) w2(S2)` with the predicate read C. Draw the precedence graph (Mermaid): T1 → T2 via r1(C)/w2(S2) (T2 inserts into the predicate T1 read) and T2 → T1 via r2(C)/w1(S1). There is a cycle, so it is not conflict-serializable.
  - Strict 2PL in PESSIMISTIC, multi-granularity (IX), deadlock detection vs. prevention, and recovery (fault injection, KILL, redo/undo, and how InnoDB relates to immediate update with WAL vs. deferred update and shadow paging).
  - Cite the experiment numbers from `experiments.md`.
- **`experiments.md`**: already produced in Phase 4. Fill in the H1–H6 "Result:" lines from the final full bench. The author may prefer to write the conclusions; ask before writing them.
- **`syllabus-map.md`**: the table from PLAN §12, with each row linking to the concrete file, test or page that demonstrates it.
- Also in `concurrency.md` (PLAN §12 M4): the active-count query **in relational algebra**, for example γ_{COUNT(*)}(σ_{account_id=a ∧ status='PLAYING' ∧ lease>now}(playback_session)).

## Stop and report.

---

# Phase 7: stretch goals (**only if the user explicitly asks**)

Each item is independent. Ask which ones.

1. **`REDIS_LEASE` strategy.** Add a `redis:7` service to `docker-compose.yml` (free, local). Claim = `SET lease:{account}:{slot} {deviceId} NX PX {LEASE_MS}` over slots 0…max_streams−1. Renew = a Lua script that extends only if the value matches (fencing). The MySQL session row is still written for the history.
   - Compare it in the lab: add it as a 7th strategy with `needsRedis`.
   - Discuss key-value stores and CAP: a single Redis node isn't partition-tolerant as a lock service, and Redlock is controversial. Cite carefully and don't overclaim.
2. **Timestamp-ordering simulator.** A pure TypeScript module plus a nerds tab.
   - Input: a schedule string like `R1(A) W2(A) W1(A)`.
   - Run it under basic TO and TO + Thomas write rule. Show the read/write timestamps per item after each operation, aborts, and ignored obsolete writes.
   - **Label it clearly as a simulation.** MySQL does not use TO.
   - Unit tests on textbook schedules.
3. **Precedence-graph builder:** the user enters a schedule; report whether it's conflict-serializable, draw the graph (SVG), and give a serial order if one exists (topological sort). Unit-tested.
4. **`TRIGGER` strategy:** a `BEFORE INSERT` trigger on `playback_session` that counts active sessions and `SIGNAL`s when over the limit. Show in the lab that it **still races**: the trigger's SELECT is a non-locking read, which makes a good "looks safe but isn't" finding. Create and drop the trigger like the unique index (only while that strategy is active).

For each: a tests-first design, a deviation note in `CLAUDE.md`, and a stop for review.
