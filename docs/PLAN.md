# PlaySync — Multi-Device Playback Coordination as a Concurrency-Control Lab

Implementation plan for PlaySync. Read this whole file before writing any code. Build phase by phase and **stop after each phase** with a short summary, the commands to verify it, and anything that deviated from this plan.

Everything here is free and local: MySQL Community (Docker), Node.js, React, open-source npm packages. **No paid APIs, no cloud services, no API keys.**

---

## 1. What we are building and why

**Motivating observation (not a claim about Apple):** a streaming app notices when the same account starts playback on a second device. Apple's public documentation says accounts have device and simultaneous-stream limits but does not describe the internal mechanism, so the project never claims "this is how Apple does it."

**Research question:** How can a relational DBMS maintain a consistent, real-time view of concurrent playback sessions across a user's devices, and what are the correctness and performance trade-offs of different concurrency-control strategies for enforcing a per-account stream limit?

**The invariant being protected (the heart of the project):**

> For every account `a`: the number of sessions with `status = 'PLAYING'` and an unexpired lease is ≤ `a.max_streams`.

A primary key gives each row an identity; it does not protect this invariant by itself. The invariant is about a *set* of rows, so it needs concurrency control. The project demonstrates this empirically.

**Deliverables:**

1. A working multi-device player (real phone + Mac over LAN, plus a simulated "device wall") with real-time sync, leases, heartbeats, takeover, and zombie-device fencing.
2. A **Concurrency Lab** that fires N simultaneous claims under six pluggable strategies and measures invariant violations, aborts, deadlocks, latency and throughput, saving every run to the DB.
3. A **Transaction Stepper** that runs two real MySQL transactions statement-by-statement and shows the live InnoDB lock table (`performance_schema.data_locks`), lock waits, deadlocks, and KILL-based rollback.
4. A second, classic **lost-update** experiment (song play counter).
5. `docs/` material for the coursework report: ER/EER, FDs and normalization, concurrency analysis, experiment results, syllabus map.

---

## 2. Corrections to the original idea (design decisions, keep these)

These refine the earlier brainstorm and must be reflected in code and docs.

1. **The two-devices-both-start race is write skew / a phantom anomaly, not a lost update.** Both transactions read the same predicate ("active sessions for account 101"), find nothing, and insert *different* rows. Lost update is a separate anomaly (two read-modify-writes on the *same* row), so it gets its own experiment (play counter).
2. **"Wrap it in a transaction" does not fix the race at MySQL's default isolation.** Under REPEATABLE READ (default) and READ COMMITTED, a plain `SELECT` is a non-locking snapshot read, so both transactions still see zero. SERIALIZABLE *does* prevent it, but InnoDB achieves that by turning the SELECT into shared next-key locks, which makes the two INSERTs deadlock; one transaction is rolled back and must retry. The lab shows all three.
3. **Lock the parent row, not the empty range.** `SELECT … FOR UPDATE` on `playback_session` when no rows match takes gap locks and invites deadlocks. The correct pessimistic pattern locks the single `account` row as a per-account mutex. The account's primary key is therefore the *lock target*, which is the real answer to "does it involve a unique primary key?"
4. **Locks and MVCC snapshots interact.** Under REPEATABLE READ, if a transaction does a plain SELECT *before* acquiring the account lock, its snapshot is already fixed and it can violate the invariant even while holding the lock. This is a stepper scenario (`PESSIMISTIC_RR_PITFALL`). The production pessimistic strategy runs at READ COMMITTED with the lock as its first statement.
5. **Heartbeats alone are not enough; use leases + fencing.** A session holds a *lease* (`lease_expires_at`). Heartbeats extend it. A lease that has expired can never be revived, and a heartbeat for a preempted/expired session is rejected (HTTP 410). This stops a "zombie" device (e.g., laptop waking from sleep) from resurrecting a session that was taken over.
6. **All time comparisons happen in SQL using `NOW(3)`**, a single clock. Clients receive `leaseRemainingMs` computed by the DB, never absolute times to compare locally, so phone/Mac clock skew doesn't matter.
7. **MySQL has no partial unique indexes and no SQL ASSERTION.** A declarative "one active session per account" is possible with a stored generated column plus a UNIQUE index (NULLs don't collide). That trick cannot express "≤ N", which is itself a finding.
8. **Schema normalization finding:** `playback_session` stores both `device_id` and `account_id`, and `device_id → account_id`, so `account_id` is transitively dependent on the key: a 3NF violation. It is a *deliberate, justified denormalization* (needed so the per-account index and count work without a join), and consistency is enforced with a **composite foreign key** `(device_id, account_id) → device(device_id, account_id)`. Document this.
9. **No separate PLAYBACK_HISTORY table.** Ended sessions already are history; a second table would be redundant.
10. **Publish after commit.** Real-time broadcasts are sent only after COMMIT (never from inside a transaction), otherwise clients could see state that is later rolled back, an application-level dirty read.
11. **Every state change bumps `account.state_version`.** That single counter is used for optimistic concurrency *and* lets clients discard out-of-order WebSocket messages (keep the highest version seen).
12. **Timestamp ordering and Thomas write rule are not implemented by MySQL.** They appear only as a stretch-goal simulator, clearly labelled as simulation.

---

## 3. Tech stack (all free)

| Layer | Choice | Notes |
|---|---|---|
| DB | MySQL 8.4 (Docker image `mysql:8.4`) | InnoDB, `performance_schema` on, `innodb_print_all_deadlocks=ON`. Alternative: `brew install mysql` on macOS. |
| Backend | Node 20+, TypeScript (strict), Express, `mysql2/promise`, `socket.io`, `zod` | **Raw SQL only, no ORM.** An ORM would hide the exact locking statements this project is about. |
| Frontend | React + Vite + TypeScript, React Router, Tailwind, `socket.io-client`, `recharts` | |
| Tests | `vitest` (+ `supertest`) against the real Dockerized MySQL | |
| Tooling | npm workspaces, `tsx` for running TS scripts | |

Optional stretch only: Redis (Docker, free) for a NoSQL key-value lease comparison.

---

## 4. Repository layout

```
playsync/
  docker-compose.yml
  .env.example
  package.json                 # npm workspaces: server, web
  db/
    schema.sql
    seed.sql
  server/
    src/
      index.ts                 # express + socket.io bootstrap
      config.ts                # env parsing (zod)
      db/pool.ts               # app pool + lab pool
      db/tx.ts                 # withTx(), isolation, retry-on-1213/1205
      db/errors.ts             # MySQL error-code helpers (1062, 1205, 1213)
      strategies/
        types.ts
        naive.ts
        txnRr.ts
        serializable.ts
        pessimistic.ts
        optimistic.ts
        constraint.ts
        index.ts               # registry
      services/
        playback.ts            # claim / heartbeat / pause / release
        accountState.ts        # snapshot + version bump helper
        leaseReaper.ts
      realtime/socket.ts       # rooms: account:{id}, device:{id}
      lab/
        raceRunner.ts
        lostUpdate.ts
        invariant.ts
        indexExperiment.ts
        stepper/
          scenarios.ts
          engine.ts
          locks.ts
      routes/
        accounts.ts devices.ts playback.ts lab.ts stepper.ts
    test/
  web/
    src/
      lib/api.ts lib/socket.ts lib/versionedStore.ts
      pages/DevicePage.tsx DeviceWall.tsx LabPage.tsx StepperPage.tsx IndexPage.tsx
      components/…
  scripts/
    bench.ts                   # CLI experiment matrix → CSV
  docs/
    er.md normalization.md concurrency.md experiments.md syllabus-map.md results/
```

---

## 5. Database

### 5.1 docker-compose.yml

```yaml
services:
  mysql:
    image: mysql:8.4
    command:
      - --innodb-print-all-deadlocks=ON
      - --performance-schema=ON
      - --max-connections=300
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: playsync
    ports: ["3306:3306"]
    volumes:
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./db/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
      - mysql-data:/var/lib/mysql
volumes:
  mysql-data:
```

For a local student project, connect as root. (The lab toggles indexes and reads `performance_schema`, which needs broad privileges.) Provide `npm run db:reset` that runs `docker compose down -v && docker compose up -d`.

### 5.2 schema.sql

```sql
CREATE TABLE account (
  account_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(40)  NOT NULL,
  display_name    VARCHAR(80)  NOT NULL,
  max_streams     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  conflict_policy ENUM('REJECT','TAKEOVER','ASK') NOT NULL DEFAULT 'ASK',
  state_version   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  is_lab          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_account_username UNIQUE (username),          -- candidate key
  CONSTRAINT ck_account_max_streams CHECK (max_streams BETWEEN 1 AND 10)
) ENGINE=InnoDB;

CREATE TABLE device (
  device_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id   INT UNSIGNED NOT NULL,
  device_name  VARCHAR(60) NOT NULL,
  device_type  ENUM('DESKTOP','MOBILE','TABLET','WEB') NOT NULL,  -- EER discriminator
  last_seen_at DATETIME(3) NULL,
  CONSTRAINT uq_device_account_name UNIQUE (account_id, device_name), -- candidate key
  CONSTRAINT uq_device_id_account   UNIQUE (device_id, account_id),   -- target of composite FK
  CONSTRAINT fk_device_account FOREIGN KEY (account_id)
    REFERENCES account(account_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE song (
  song_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  artist      VARCHAR(120) NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  play_count  BIGINT UNSIGNED NOT NULL DEFAULT 0            -- lost-update experiment
) ENGINE=InnoDB;

CREATE TABLE playback_session (
  session_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        INT UNSIGNED NOT NULL,                   -- deliberate denormalization
  device_id         INT UNSIGNED NOT NULL,
  song_id           INT UNSIGNED NOT NULL,
  status            ENUM('PLAYING','PAUSED','ENDED','PREEMPTED','EXPIRED') NOT NULL,
  position_ms       INT UNSIGNED NOT NULL DEFAULT 0,
  started_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_expires_at  DATETIME(3) NOT NULL,
  ended_at          DATETIME(3) NULL,
  strategy          VARCHAR(24) NOT NULL,
  active_account_id INT UNSIGNED
    GENERATED ALWAYS AS (IF(status = 'PLAYING', account_id, NULL)) STORED,
  CONSTRAINT fk_session_device_account FOREIGN KEY (device_id, account_id)
    REFERENCES device(device_id, account_id),
  CONSTRAINT fk_session_song FOREIGN KEY (song_id) REFERENCES song(song_id),
  INDEX ix_session_account_status_lease (account_id, status, lease_expires_at),
  INDEX ix_session_status_lease (status, lease_expires_at)
) ENGINE=InnoDB;
-- NOTE: the UNIQUE index on active_account_id is NOT created here.
-- It is added/dropped by the lab only for the CONSTRAINT strategy:
--   ALTER TABLE playback_session ADD UNIQUE INDEX uq_one_active_per_account (active_account_id);
-- If it existed permanently, the NAIVE strategy would be silently protected and the experiment would be meaningless.

CREATE TABLE playback_event (                               -- append-only audit log
  event_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        INT UNSIGNED NOT NULL,
  device_id         INT UNSIGNED NOT NULL,
  session_id        BIGINT UNSIGNED NULL,
  event_type        ENUM('CLAIM_GRANTED','CLAIM_REJECTED','PREEMPTED','PAUSED',
                         'RELEASED','EXPIRED','HEARTBEAT_REJECTED') NOT NULL,
  state_version     BIGINT UNSIGNED NOT NULL,
  client_request_id CHAR(36) NULL,
  detail            JSON NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_event_request UNIQUE (device_id, client_request_id),  -- idempotency
  INDEX ix_event_account_time (account_id, created_at)
) ENGINE=InnoDB;
-- No FKs on the log on purpose: an audit log should survive deletes. Document this.

CREATE TABLE experiment_run (
  run_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  experiment      ENUM('STREAM_LIMIT','LOST_UPDATE') NOT NULL,
  strategy        VARCHAR(24) NOT NULL,
  isolation_level VARCHAR(20) NOT NULL,
  mode            ENUM('NORMAL','TAKEOVER') NOT NULL DEFAULT 'NORMAL',
  concurrency     INT UNSIGNED NOT NULL,
  accounts        INT UNSIGNED NOT NULL,
  max_streams     TINYINT UNSIGNED NOT NULL,
  race_delay_ms   INT UNSIGNED NOT NULL,
  granted         INT UNSIGNED NOT NULL,
  rejected        INT UNSIGNED NOT NULL,
  retries         INT UNSIGNED NOT NULL,
  deadlocks       INT UNSIGNED NOT NULL,
  lock_timeouts   INT UNSIGNED NOT NULL,
  errors          INT UNSIGNED NOT NULL,
  violations      INT UNSIGNED NOT NULL,   -- excess active sessions (or lost increments)
  p50_ms          DECIMAL(10,2) NOT NULL,
  p95_ms          DECIMAL(10,2) NOT NULL,
  throughput_rps  DECIMAL(10,2) NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
```

### 5.3 seed.sql

Use `WITH RECURSIVE` to generate rows.

- Demo account `brij` (max_streams 1, policy ASK) with devices: `MacBook` (DESKTOP), `iPhone` (MOBILE), `iPad` (TABLET), `Browser` (WEB).
- 12 songs with **made-up** titles/artists and durations of 2–4 minutes. No real audio; playback is a simulated progress bar.
- 16 lab accounts `lab_01 … lab_16` (`is_lab = TRUE`, policy REJECT), each with 64 devices `lab-dev-01 … lab-dev-64`.
- 2 stepper accounts `step_a`, `step_b` with 2 devices each.

---

## 6. Backend

### 6.1 Config (.env)

```
DB_HOST=127.0.0.1  DB_PORT=3306  DB_USER=root  DB_PASSWORD=root  DB_NAME=playsync
PORT=4000
LEASE_MS=15000
HEARTBEAT_MS=5000
REAPER_MS=2000
DEFAULT_STRATEGY=PESSIMISTIC
APP_POOL_SIZE=20
LAB_POOL_SIZE=120
```

### 6.2 Transaction helper (`db/tx.ts`)

- `withTx(conn, isolation, fn)` runs `SET TRANSACTION ISOLATION LEVEL <iso>` then `BEGIN`, calls `fn`, then `COMMIT`; on any error `ROLLBACK` and rethrow.
- `withRetry(fn, {max: 5})` retries on `ER_LOCK_DEADLOCK` (1213), `ER_LOCK_WAIT_TIMEOUT` (1205) and the internal `OccConflictError`, with exponential backoff plus jitter (5 → 80 ms). It increments `stats.retries`, `stats.deadlocks`, `stats.lockTimeouts`.
- Strategies receive an **already-acquired connection** so the lab can pre-acquire connections and release them through a barrier.
- **Global lock order: `account` → `device` → `playback_session` → `playback_event`.** Every correct code path acquires locks in this order (deadlock prevention by resource ordering). Document it.

### 6.3 Strategy interface (`strategies/types.ts`)

```ts
export type Isolation = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface ClaimInput {
  accountId: number; deviceId: number; songId: number;
  mode: 'NORMAL' | 'TAKEOVER';          // TAKEOVER = preempt the oldest active session(s)
  clientRequestId?: string;             // idempotency key (UUID from client)
  raceDelayMs?: number;                 // lab only: sleep between check and write
  fault?: 'AFTER_SESSION_INSERT';       // recovery demo: throw before commit
}

export type ClaimResult =
  | { outcome: 'GRANTED'; sessionId: number; stateVersion: number; preempted: number[] }
  | { outcome: 'REJECTED'; stateVersion: number;
      holders: { sessionId: number; deviceId: number; deviceName: string }[] };

export interface Stats { retries: number; deadlocks: number; lockTimeouts: number }

export interface Strategy {
  name: 'NAIVE' | 'TXN_RR' | 'SERIALIZABLE' | 'PESSIMISTIC' | 'OPTIMISTIC' | 'CONSTRAINT';
  defaultIsolation: Isolation;
  supportsMaxStreamsAbove1: boolean;     // false only for CONSTRAINT
  needsUniqueIndex: boolean;             // true only for CONSTRAINT
  claim(conn: PoolConnection, input: ClaimInput, stats: Stats): Promise<ClaimResult>;
}
```

"Active" always means `status = 'PLAYING' AND lease_expires_at > NOW(3)`.

Shared helpers:
- `insertSession(conn, …)` inserts with `lease_expires_at = NOW(3) + INTERVAL (? * 1000) MICROSECOND` (param = LEASE_MS).
- `bumpVersion(conn, accountId)` runs `UPDATE account SET state_version = LAST_INSERT_ID(state_version + 1) WHERE account_id = ?` then `SELECT LAST_INSERT_ID()`. Call it **after** the session INSERT, because the INSERT overwrites `LAST_INSERT_ID()`.
- `writeEvent(conn, …)`.
- Takeover: mark the oldest `(active − max_streams + 1)` active sessions `PREEMPTED` with `ended_at = NOW(3)`, ordered by `started_at`.

### 6.4 The six strategies

| Strategy | Isolation | Mechanism | Expected lab result |
|---|---|---|---|
| `NAIVE` | autocommit, no txn | `SELECT COUNT` → sleep → `INSERT` → bump | **Violations** under contention |
| `TXN_RR` | REPEATABLE READ (lab option: READ COMMITTED) | same statements inside BEGIN/COMMIT | **Still violations** (ACID ≠ protection from write skew) |
| `SERIALIZABLE` | SERIALIZABLE | same statements; InnoDB S next-key locks | 0 violations, **deadlocks + retries** |
| `PESSIMISTIC` | READ COMMITTED | `SELECT … FROM account WHERE account_id=? FOR UPDATE` first, then count, insert, bump | 0 violations, waits, higher p95 under contention |
| `OPTIMISTIC` | READ COMMITTED | read `state_version` + count without locks → sleep → `UPDATE account SET state_version=v+1 WHERE account_id=? AND state_version=v`; `affectedRows=0` means conflict → rollback and retry | 0 violations, **abort/retry rate rises with contention** |
| `CONSTRAINT` | READ COMMITTED | expire stale rows for account → (TAKEOVER: preempt) → `INSERT`; `ER_DUP_ENTRY` (1062) on `uq_one_active_per_account` means conflict | 0 violations, cheapest, **max_streams = 1 only** |

Details that must be right:

- **OPTIMISTIC:** the CAS `UPDATE` is the validation phase. It briefly takes an X lock on the account row; that is fine and should be noted in the docs ("OCC on a locking engine still validates with a short write lock"). Its correctness depends on rule 11: every state change (claim, pause, release, preempt, expire) bumps `state_version`. Heartbeats don't bump it because they don't change the active set, and they can never revive an expired lease (§6.5), so the active count can only drop over time without a version bump. The only consequence is a rare spurious rejection, never a violation. Write this argument in `docs/concurrency.md`.
- **CONSTRAINT:** its lock order is session → account, which differs from the reaper's order, so reaper/claim deadlocks are possible. They are handled by `withRetry`, and the lab should report them as a real finding.
- **Idempotency (all strategies):** if `clientRequestId` is present and a `playback_event` already exists for `(device_id, client_request_id)`, return the original outcome instead of claiming again (handles double-click and client retries).
- **Fault injection:** if `fault === 'AFTER_SESSION_INSERT'`, throw after the INSERT and before the event and COMMIT. The test asserts no session row exists afterwards (atomicity via rollback).

### 6.5 Playback service and endpoints

All client commands are REST; the server pushes state over socket.io. The live app uses `DEFAULT_STRATEGY` (switchable in an admin panel on the Device Wall).

| Method & path | Body | Result |
|---|---|---|
| `GET /api/accounts/:id/state` | – | snapshot (see below) |
| `PUT /api/accounts/:id/settings` | `{maxStreams, conflictPolicy}` | updated account, version bumped |
| `POST /api/devices/:id/hello` | – | updates `last_seen_at` |
| `POST /api/playback/claim` | `{deviceId, songId, mode, clientRequestId}` | 200 GRANTED, or 409 `{code:'LIMIT_REACHED', holders, policy}` |
| `POST /api/playback/heartbeat` | `{sessionId, deviceId, positionMs}` | 200 `{leaseRemainingMs}`, or 410 `{code:'SESSION_LOST', reason}` |
| `POST /api/playback/pause` | `{sessionId, deviceId}` | session → PAUSED, version bump |
| `POST /api/playback/release` | `{sessionId, deviceId}` | session → ENDED, version bump |
| `PUT /api/admin/strategy` | `{strategy}` | switch live strategy |

Policy handling on conflict: `REJECT` returns 409. `TAKEOVER` retries internally with `mode: 'TAKEOVER'`. `ASK` returns 409 with `canTakeOver: true`; the client shows a "Playing on MacBook. Take over?" dialog and, on confirm, sends a new claim with `mode: 'TAKEOVER'` and a new `clientRequestId`.

**Pause semantics:** only PLAYING holds a stream slot. Resuming a PAUSED session goes through `claim` again.

**Heartbeat SQL (fencing):**

```sql
UPDATE playback_session
SET lease_expires_at = NOW(3) + INTERVAL (? * 1000) MICROSECOND, position_ms = ?
WHERE session_id = ? AND device_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3);
```

If `affectedRows = 0`, look up the row's status and return 410 with reason `PREEMPTED`, `EXPIRED` or `ENDED`, and write a `HEARTBEAT_REJECTED` event. The client must stop playback immediately.

**Snapshot shape** (also the socket payload):

```ts
{ accountId, stateVersion, maxStreams, conflictPolicy, strategy,
  devices: [{ deviceId, deviceName, deviceType, online }],
  sessions: [{ sessionId, deviceId, deviceName, songTitle, status, positionMs, leaseRemainingMs }] }
```

`leaseRemainingMs` is computed in SQL: `TIMESTAMPDIFF(MICROSECOND, NOW(3), lease_expires_at) DIV 1000`.

### 6.6 Lease reaper (`services/leaseReaper.ts`)

Every `REAPER_MS`:
1. `SELECT DISTINCT account_id FROM playback_session WHERE status='PLAYING' AND lease_expires_at <= NOW(3)` (uses `ix_session_status_lease`).
2. For each account, in its own READ COMMITTED transaction following the global lock order: `SELECT … FROM account WHERE account_id=? FOR UPDATE`; `UPDATE playback_session SET status='EXPIRED', ended_at=lease_expires_at WHERE account_id=? AND status='PLAYING' AND lease_expires_at <= NOW(3)`; if rows > 0, bump the version and write EXPIRED events; COMMIT.
3. After commit, broadcast the snapshot and emit `session_lost` to the affected device rooms.

The reaper is **not** what makes claims correct (claims ignore expired leases anyway). It keeps the UI truthful and clears rows for the CONSTRAINT strategy.

### 6.7 Real-time (`realtime/socket.ts`)

- On connect, the client sends `{accountId, deviceId}` and joins rooms `account:{id}` and `device:{id}`. Keep an in-memory online set; update `last_seen_at`.
- After **every committed** state change, emit `account_state` (snapshot) to `account:{id}`.
- Emit `session_lost {sessionId, reason, byDeviceName?}` to `device:{id}` on preemption or expiry.
- A socket disconnect does **not** end a session. The lease handles that, so short network blips don't kill playback.
- `web/src/lib/versionedStore.ts` applies a snapshot only if `stateVersion` > the last applied version.

---

## 7. Frontend pages

1. **`/device?account=brij&device=MacBook`**: one real device client. Song list, play/pause, simulated progress bar, a "Now playing on iPhone" banner when another device holds the stream, an ASK takeover dialog, a toast when the session is lost ("Playback moved to iPhone"), a connection dot, and a debug strip with lease countdown, state version and strategy. Heartbeats every `HEARTBEAT_MS` while PLAYING.
2. **`/wall`**: a Device Wall for projector demos. Four device panels for `brij`, each with its **own** socket connection and device identity, plus an admin bar (strategy selector, max streams, policy). Each panel has a **"Freeze (simulate sleep)"** toggle that stops heartbeats and queues them. Unfreezing sends the stale heartbeat, which gets a 410 and the panel stops: the zombie/fencing demo.
3. **`/lab`**: Concurrency Lab. Form with experiment, strategy, isolation, concurrency (2–100), accounts (1 = maximum contention, 16 = spread), max streams, race delay ms, mode, and trials. A "Run all strategies" button. Results table and recharts: violations by strategy, retries/deadlocks by strategy, p95 latency vs concurrency, throughput. A run history loaded from `experiment_run`.
4. **`/stepper`**: Transaction Stepper (see §8.3). Two columns T1 and T2 listing SQL statements with a Step button each, per-statement status (DONE / WAITING / ERROR) and result rows, a live lock table, a wait-for graph (two nodes, arrows for waits; a cycle means deadlock), a deadlock banner showing the victim and the `LATEST DETECTED DEADLOCK` text, and **Kill T1 / Kill T2** buttons.
5. **`/index-lab`**: the indexing experiment (§8.4).

Running on a real phone: start Vite with `--host` and bind Express to `0.0.0.0`, then open `http://<mac-lan-ip>:5173/device?...` on the phone. Allow the macOS firewall prompt. Campus Wi-Fi often isolates clients from each other; if the phone can't reach the Mac, turn on the phone's hotspot and connect the Mac to it.

---

## 8. Lab internals

### 8.1 Race runner (`lab/raceRunner.ts`), STREAM_LIMIT experiment

1. **Reset:** delete sessions and events for `is_lab` accounts; set `max_streams`, `state_version = 0`. Add or drop `uq_one_active_per_account` according to `strategy.needsUniqueIndex` (reject `CONSTRAINT` with `max_streams > 1`).
2. **Pre-acquire** `concurrency` connections from the lab pool (`LAB_POOL_SIZE` ≥ max concurrency). If the pool is smaller than the concurrency, requests queue at the pool and the race disappears; guard against this.
3. **Barrier:** every worker awaits one shared promise, then all are released at once. Request `i` targets lab account `i % accounts` using device `floor(i / accounts)`.
4. Record per-request latency with `process.hrtime.bigint()`, outcome, and stats.
5. **Invariant check** after all settle:

```sql
SELECT a.account_id, a.max_streams, COUNT(*) AS active
FROM account a
JOIN playback_session s
  ON s.account_id = a.account_id AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3)
WHERE a.is_lab = TRUE
GROUP BY a.account_id, a.max_streams
HAVING COUNT(*) > a.max_streams;
```

`violations = Σ(active − max_streams)` over returned rows. In TAKEOVER mode every request may be granted, yet the final state must still satisfy the invariant.

6. Insert one `experiment_run` row per trial; return per-trial and aggregate results.

### 8.2 Lost-update experiment (`lab/lostUpdate.ts`)

N concurrent increments of one song's `play_count` (reset to 0 first). Variants:
- `NAIVE_RMW`: `SELECT play_count` → sleep → `UPDATE song SET play_count = ?`
- `ATOMIC`: `UPDATE song SET play_count = play_count + 1`
- `LOCKED`: `SELECT … FOR UPDATE` → `UPDATE`
- `CAS`: `UPDATE song SET play_count = ? + 1 WHERE song_id = ? AND play_count = ?`, retry on 0 rows

`violations = N − final play_count` (lost increments).

### 8.3 Transaction Stepper (`lab/stepper/`)

**Engine:** the backend holds two dedicated, unpooled connections (T1, T2) plus one admin connection. It records `CONNECTION_ID()` for each and sets `innodb_lock_wait_timeout = 30` on T1/T2. `POST /api/lab/stepper/step {txn}` sends the next statement without blocking the HTTP response: if the query hasn't finished within 300 ms, respond `WAITING` and push the completion later via a socket event `stepper_update`. Errors (1213 deadlock, 1205 timeout, 1062 duplicate) are shown inline. On deadlock, fetch `SHOW ENGINE INNODB STATUS` and extract the `LATEST DETECTED DEADLOCK` section.

**Lock inspector** (`GET /api/lab/locks`, polled every 500 ms on the page):

```sql
SELECT t.PROCESSLIST_ID AS conn_id, l.OBJECT_NAME, l.INDEX_NAME,
       l.LOCK_TYPE, l.LOCK_MODE, l.LOCK_STATUS, l.LOCK_DATA
FROM performance_schema.data_locks l
JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
WHERE l.OBJECT_SCHEMA = 'playsync';

SELECT rt.PROCESSLIST_ID AS waiting_conn, bt.PROCESSLIST_ID AS blocking_conn
FROM performance_schema.data_lock_waits w
JOIN performance_schema.threads rt ON rt.THREAD_ID = w.REQUESTING_THREAD_ID
JOIN performance_schema.threads bt ON bt.THREAD_ID = w.BLOCKING_THREAD_ID;
```

Map connection ids to T1/T2 labels. In the UI, explain the lock modes: `IX` (table-level intention lock, i.e. multi-granularity locking), `X,REC_NOT_GAP` (record lock), `S`/`X` (next-key), `X,GAP`, and `X,INSERT_INTENTION`. Note that FK checks take `S,REC_NOT_GAP` locks on parent rows (device, song).

**Scenarios** (`scenarios.ts`; each has `id, title, syllabusRefs, isolation per txn, steps per txn, expected outcome, explanation`), all using the stepper accounts, which are reset before each run:

1. `RACE_TXN_RR`: both txns: BEGIN; count; INSERT; COMMIT → both commit → invariant violated (shown by running the invariant query).
2. `PESSIMISTIC_RC`: T1 locks the account row; T2's `FOR UPDATE` shows WAITING in the lock table; T1 commits; T2 sees the session and rejects.
3. `PESSIMISTIC_RR_PITFALL`: at REPEATABLE READ, T1 does a plain count *first* (snapshot fixed, sees 0), then `FOR UPDATE`, which waits for T2. T2 inserts and commits. T1 gets the lock, counts again (still 0 from the snapshot), inserts → violation despite locking.
4. `SERIALIZABLE_DEADLOCK`: both count (shared next-key locks visible), both INSERT (insert-intention waits) → InnoDB detects the wait-for cycle and rolls back one victim.
5. `OPTIMISTIC_CAS`: both read `state_version = v`; T1's CAS succeeds and commits; T2's CAS affects 0 rows → abort.
6. `CLASSIC_DEADLOCK`: "family-plan transfer". T1 locks account A then B; T2 locks B then A → deadlock. Variant `ORDERED_LOCKING`: both lock the lower id first → no deadlock (prevention by ordering).
7. `KILL_RECOVERY`: T1 inserts a session (uncommitted, locks visible); press **Kill T1** (admin runs `KILL <conn_id>`) → InnoDB rolls back via undo log → locks disappear, row gone, T2 proceeds.

### 8.4 Index experiment (`lab/indexExperiment.ts`, `/index-lab`)

1. Generate about 20,000 historical ENDED sessions spread over lab accounts.
2. For each of {with `ix_session_account_status_lease`, without it}: show `EXPLAIN` and `EXPLAIN ANALYZE` of the active-count query; then open a REPEATABLE READ transaction, run the CONSTRAINT strategy's expire `UPDATE` for one account, count rows in `data_locks` for that connection, and roll back.
3. Display the result: without the index the scan is a full table scan and InnoDB locks **every scanned row**, so one account's claim blocks all other accounts. This ties indexing (Module 4) directly to locking (Module 6). Restore the index at the end.

### 8.5 CLI bench (`scripts/bench.ts`)

Matrix: 6 strategies × isolation where applicable × concurrency {2, 8, 32, 64} × accounts {1, 16} × race delay {0, 20 ms} × 10 trials, plus the lost-update variants. Write CSV to `docs/results/` and a Markdown summary table to `docs/experiments.md`.

---

## 9. Tests (vitest, real MySQL)

- For each of PESSIMISTIC, OPTIMISTIC, SERIALIZABLE, CONSTRAINT: 20 trials × concurrency 50 × accounts 1 × race delay 20 ms → assert `violations === 0`.
- NAIVE and TXN_RR with race delay 20 ms → assert `violations > 0` in at least one trial (tolerant of flakiness).
- TAKEOVER mode with each safe strategy: final state satisfies the invariant.
- Heartbeat on a preempted session returns 410; heartbeat after lease expiry returns 410 and does **not** extend the lease.
- Fault injection `AFTER_SESSION_INSERT` leaves no session row and no event row.
- Idempotency: the same `clientRequestId` twice yields one session.
- Lost update: NAIVE_RMW loses increments with delay; ATOMIC, LOCKED and CAS end at exactly N.
- Reaper expires a session within `LEASE_MS + REAPER_MS` and bumps the version.

---

## 10. Build phases (stop and report after each)

**Phase 0: Scaffold.** Workspaces, TS configs, docker-compose, `.env.example`, npm scripts (`db:up`, `db:reset`, `dev`, `test`, `bench`). *Done when* `npm run db:up` works and `GET /api/health` returns the DB version.

**Phase 1: Schema and seed.** `schema.sql`, `seed.sql`, plus `docs/er.md` (Mermaid ER diagram) and `docs/normalization.md` covering: FDs for every table; candidate keys (`username`; `(account_id, device_name)`); the 3NF analysis including the deliberate `playback_session.account_id` denormalization and its composite-FK remedy; the BCNF check for the other tables; the EER specialization of DEVICE (disjoint, total, attribute-defined on `device_type`, mapped as a single relation with a type attribute) and the alternative mappings. *Done when* seed counts are correct and inserting a session with a device from the wrong account fails with an FK error.

**Phase 2: Strategies and playback service.** `tx.ts`, all six strategies, claim/heartbeat/pause/release routes, idempotency, fault injection, and tests from §9 except the lab ones. *Done when* the tests pass.

**Phase 3: Real-time, reaper, and UI.** socket.io rooms, publish-after-commit, versioned client store, the lease reaper, `/device` and `/wall` including freeze/zombie. *Done when* two browser tabs plus a real phone show the handoff live, ASK/TAKEOVER/REJECT all behave, closing a tab expires its session after the lease, and freeze → takeover → unfreeze yields a 410.

**Phase 4: Concurrency Lab.** Race runner, lost-update runner, `experiment_run` persistence, `/lab` page with charts, CLI bench. *Done when* the lab tests pass and "Run all strategies" reproduces the expected pattern from §6.4.

**Phase 5: Transaction Stepper.** Engine, lock inspector, all seven scenarios, `/stepper` page. *Done when* every scenario produces its expected outcome and the lock table matches the explanation.

**Phase 6: Index experiment and docs.** `/index-lab`; `docs/concurrency.md` (each strategy's schedule, locks taken, isolation, the OCC correctness argument, the lock-order rule, conflict-serializability of the NAIVE schedule shown with a precedence-graph cycle); `docs/experiments.md` from the bench; `docs/syllabus-map.md` (§12).

**Phase 7: Stretch (only if asked).**
- `REDIS_LEASE` strategy with `SET key value NX PX` on a free local Redis container. Compare it in the lab and discuss key-value stores and CAP (a single Redis node is not partition-tolerant as a lock service).
- Timestamp-ordering simulator: a pure TS module taking a schedule (e.g. `R1(A) W2(A) W1(A)`) and running it under basic TO and TO + Thomas write rule, showing aborts and ignored obsolete writes. Clearly labelled a simulation.
- Precedence-graph builder: take a user-entered schedule and report whether it is conflict-serializable, drawing the graph.
- `TRIGGER` strategy: a `BEFORE INSERT` trigger that counts and `SIGNAL`s. It still races because the trigger's SELECT is a non-locking read, which is a good "looks safe but isn't" finding.

---

## 11. Research framing for the report

**Independent variables:** strategy, isolation level, concurrency (2–100), contention (1 account vs 16), race-window delay, mode (NORMAL/TAKEOVER).
**Dependent variables:** invariant violations, grants/rejections, retries, deadlocks, lock timeouts, p50/p95 latency, throughput.

**Hypotheses:**
- H1: NAIVE and TXN_RR (at both RC and RR) violate the invariant under contention; the violation rate rises with concurrency and race delay.
- H2: PESSIMISTIC never violates; its p95 latency grows with contention on a single account but stays flat when load is spread over 16 accounts.
- H3: OPTIMISTIC never violates; its retry rate is near zero at low contention and grows sharply at high contention (the classic OCC vs. locking trade-off).
- H4: SERIALIZABLE never violates but converts conflicts into deadlocks and retries.
- H5: CONSTRAINT has the lowest overhead but can only express max_streams = 1.
- H6: Removing the composite index increases the lock footprint and makes independent accounts block each other.

**What is actually new here** (state this honestly): none of the individual techniques are new. The contribution is the combination: a lease + fencing model for multi-device sessions, version-ordered real-time sync, a reproducible harness that measures invariant violations across six strategies on a real DBMS, and live visualization of InnoDB locks for each schedule. That goes further than the usual booking-system CRUD project, which typically demonstrates a single locking method without measurement.

---

## 12. Syllabus map (for `docs/syllabus-map.md`)

| Module / topic | Where it shows up |
|---|---|
| M1 architecture, three-schema, client-server | React client ↔ Express ↔ MySQL; views of the schema at the external (snapshot API), conceptual (ER) and internal (indexes, InnoDB) levels |
| M2 keys, FKs, integrity, NULL handling | PKs, candidate keys, composite FK, CHECK, the generated column relying on NULLs not colliding in UNIQUE |
| M2 ER / EER, mapping | `docs/er.md`, DEVICE specialization, session as an aggregation used by events |
| M3 FDs, normalization, BCNF | `docs/normalization.md`, the deliberate 3NF violation and its justification |
| M4 indexing, B+ tree, query optimization | Composite index, EXPLAIN / EXPLAIN ANALYZE, index-lab lock footprint; the count query written in relational algebra (σ, π, γ) |
| M5 transactions, ACID, schedules, serializability | Race runner, stepper schedules, precedence-graph cycle for NAIVE |
| M5 recovery | Fault injection rollback, KILL_RECOVERY (undo), discussion of InnoDB redo/undo as immediate-update with WAL vs deferred update and shadow paging |
| M6 lost update | Play-counter experiment |
| M6 lock-based protocols, 2PL, compatibility | PESSIMISTIC (strict 2PL: locks held until commit), S/X/IX in the lock inspector |
| M6 deadlocks: detection and prevention | SERIALIZABLE_DEADLOCK, CLASSIC_DEADLOCK vs ORDERED_LOCKING, InnoDB wait-for-graph detection |
| M6 multi-granularity locking | IX table locks alongside record locks in `data_locks` |
| M6 timestamp protocols, Thomas write rule | Stretch simulator (MySQL doesn't use TO) |
| M7 NoSQL, key-value, CAP | Stretch Redis lease strategy and comparison |

---

## 13. Rules for the implementer

- Raw parameterized SQL via `mysql2/promise` only. No ORM, no query builder.
- Never broadcast from inside a transaction; broadcast after COMMIT.
- Always `ROLLBACK` in `catch` and release connections in `finally`.
- No authentication or passwords; pick the account by username (out of scope, say so in the README).
- No paid services, no external APIs, no API keys, no telemetry.
- Keep strategies small and readable. They will be shown in a viva, so comment each one with the anomaly it prevents or allows.
- After each phase: run tests, list the commands to verify, then stop.
