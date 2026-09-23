# Functional dependencies and normalization

This analysis covers [`db/schema.sql`](../db/schema.sql). The ER model is in [er.md](er.md).

Notation: `X → Y` means the attribute set X functionally determines Y. A **prime** attribute belongs to some candidate key. A relation is in

- **3NF** if for every non-trivial FD `X → A`, either X is a superkey or A is prime, and
- **BCNF** if for every non-trivial FD `X → A`, X is a superkey.

Every table's primary key is a single surrogate attribute, so partial dependencies on the PK can't exist and **2NF reduces to "is there a composite candidate key with a partial dependency?"** That is checked per table below.

---

## 1. `account`

**FDs**
- `account_id → username, display_name, max_streams, conflict_policy, state_version, is_lab, created_at`
- `username → account_id` (and hence every other attribute). Enforced by `uq_account_username`.

**Candidate keys:** `{account_id}`, `{username}`.

**Normal form: BCNF.** Both determinants are candidate keys, and no other FD holds. For example, `max_streams` is chosen per account and isn't implied by `conflict_policy` or `is_lab`.

`state_version` is a counter, not derived data. It is bumped on every state change and is the basis for optimistic concurrency and client-side ordering (PLAN.md §2 item 11).

## 2. `device`

**FDs**
- `device_id → account_id, device_name, device_type, last_seen_at`
- `{account_id, device_name} → device_id` (and hence every other attribute). Enforced by `uq_device_account_name`.

**Candidate keys:** `{device_id}`, `{account_id, device_name}`.

`{device_id, account_id}` is also declared UNIQUE (`uq_device_id_account`), but it is a **superkey, not a candidate key**, because it isn't minimal. It exists only because a foreign key must reference a set of columns covered by a unique index, and the composite FK from `playback_session` targets exactly these two columns (§4).

**2NF check** for the composite key `{account_id, device_name}`: the only non-prime attributes are `device_type` and `last_seen_at`. Neither is determined by `account_id` alone or by `device_name` alone. Two accounts can both have an "iPhone", and one account can't have two devices with the same name. So there is no partial dependency.

**Normal form: BCNF.** The only determinants are the two candidate keys.

## 3. `song`

**FDs**
- `song_id → title, artist, duration_ms, play_count`

**Candidate keys:** `{song_id}`. `{title, artist}` is **not** assumed to be a key, because the same artist can release two recordings with the same title (live version, remaster).

**Normal form: BCNF.**

`play_count` is a stored counter that could in principle be derived by counting sessions. It is kept on purpose as the target of the lost-update experiment (§8.2 of the plan). That is a redundancy question, not a normal-form one, since there is no non-trivial FD among the song's attributes.

## 4. `playback_session`: the deliberate 3NF violation

**FDs**
1. `session_id → account_id, device_id, song_id, status, position_ms, started_at, lease_expires_at, ended_at, strategy, active_account_id`
2. `device_id → account_id`. A device belongs to exactly one account. This is the FD from `device`, which also holds inside this table.
3. `{status, account_id} → active_account_id`. This is the generated column: `IF(status='PLAYING', account_id, NULL)`.

**Candidate keys:** `{session_id}` only. A device can have many sessions over time, and so can a song.

**Normal form: 2NF, but not 3NF (and so not BCNF).**
- FD 2 is a **transitive dependency**: `session_id → device_id → account_id`. `device_id` is not a superkey of this relation, and `account_id` is not prime. This violates 3NF.
- FD 3 is a second, smaller violation of the same kind. Its determinant `{status, account_id}` isn't a superkey, and `active_account_id` isn't prime.

### 4.1 The textbook decomposition

Drop `account_id` (and the generated column) from the session:

```
playback_session(session_id, device_id, song_id, status, position_ms, …)
device(device_id, account_id, device_name, device_type, last_seen_at)
```

This is **lossless**, because the shared attribute `device_id` is a key of `device`, and **dependency-preserving**, because `device_id → account_id` now lives entirely in `device`. The result is in BCNF.

### 4.2 Why we don't decompose

The whole project revolves around one per-account predicate:

> the number of sessions with `status = 'PLAYING'` and an unexpired lease is ≤ `max_streams` for account *a*.

Keeping `account_id` in the session row is what makes enforcing that predicate cheap and precise:

1. **Index-only counting.** `ix_session_account_status_lease (account_id, status, lease_expires_at)` answers the active count for one account with a single index range scan. After decomposition it would need a join through `device` (all of the account's devices, then their sessions), which is slower and has a bigger plan.
2. **Smaller lock footprint.** Under SERIALIZABLE, and during the CONSTRAINT strategy's expire-`UPDATE`, InnoDB locks every index record it scans. With `account_id` in the session index, the locked range is exactly that account's slice. With a join, the scan would also lock `device` rows and a wider range of session index records. That means more blocking between unrelated devices, and more deadlocks. The index experiment (§8.4) measures this.
3. **The UNIQUE-index trick needs it.** `uq_one_active_per_account` is an index on `active_account_id`, and an index can only cover columns of one table. Without `account_id` in the session row, "at most one PLAYING session per account" can't be expressed declaratively at all.
4. **The invariant query stays a single-table predicate**, which keeps it readable for the lab and the viva.

### 4.3 Controlling the anomaly: the composite foreign key

The risk that comes with a transitive dependency is an **update/insert anomaly**: a session could record `account_id = 7` while its device belongs to account 3. The schema rules that out declaratively:

```sql
CONSTRAINT uq_device_id_account UNIQUE (device_id, account_id)          -- on device
CONSTRAINT fk_session_device_account FOREIGN KEY (device_id, account_id)
  REFERENCES device(device_id, account_id)                               -- on playback_session
```

- **Insertion anomaly prevented.** An insert whose `(device_id, account_id)` pair doesn't exist in `device` fails with `ER_NO_REFERENCED_ROW_2` (1452). The test `rejects a session whose device belongs to a different account` in `server/test/schema.test.ts` shows this.
- **Update anomaly prevented.** Moving a device to another account (`UPDATE device SET account_id = …`) is rejected by the FK's default `RESTRICT` action while that device has sessions. We could have used `ON UPDATE CASCADE`, which would rewrite history to the new owner. We didn't, because past sessions should stay attributed to the account that actually played them.
- **Generated column.** FD 3 can't cause an anomaly. InnoDB recomputes `active_account_id` on every write, and it can't be written directly, so the redundant copy can never disagree with its source.

**Conclusion:** `playback_session` is intentionally in 2NF, not 3NF. The redundancy is justified by the access path and locking behaviour the concurrency strategies need, and its only anomaly is closed by a composite foreign key. This is controlled denormalization, not an accident.

## 5. `playback_event`: append-only audit log

**FDs**
1. `event_id → ` all attributes
2. `{device_id, client_request_id} → event_id` **when `client_request_id IS NOT NULL`** (`uq_event_request`). UNIQUE allows many NULLs, so this is only a key for the non-NULL part. Server-generated events such as `EXPIRED` have no request id.
3. `device_id → account_id` (semantically, via `device`)
4. `session_id → device_id, account_id` (semantically, via `playback_session`, when `session_id` is not NULL)

**Candidate keys:** `{event_id}`. `{device_id, client_request_id}` is a key only over the rows where the request id is non-NULL.

**Normal form: not 3NF**, for the same reason as the session table. FDs 3 and 4 make `account_id` (and `device_id`) transitively dependent on `event_id`. It's accepted because:
- The log is **append-only**. Rows are never updated, so the update anomaly that 3NF protects against can't happen. Each event is an immutable snapshot of what was true when it was written, including `state_version`.
- The log deliberately has **no foreign keys** (er.md §3), so it can't lean on joins to parents that might be deleted later. Storing `account_id` directly keeps it readable after a delete.
- `ix_event_account_time (account_id, created_at)` serves the per-account timeline without a join.

**1NF note:** `detail` is a JSON column, so it isn't atomic. The database treats it as an opaque payload (the reason for a rejection, holder lists). It is never filtered, joined or grouped on, so no relational query depends on its internal structure. If we ever needed to query a field inside it, that field would be promoted to a proper column.

## 6. `experiment_run`

**FDs**
- `run_id → ` all attributes

**Candidate keys:** `{run_id}`. The configuration columns `(experiment, strategy, isolation_level, mode, concurrency, accounts, max_streams, race_delay_ms)` don't form a key: the same configuration is run many times (trials), and every trial is its own row.

**No hidden FDs:** `strategy ↛ isolation_level`, because the lab lets you run `TXN_RR` at READ COMMITTED as well as REPEATABLE READ. The metrics (`granted`, `violations`, `p95_ms`, …) are measured, not computed from other columns in the row.

**Normal form: BCNF.**

## 7. Summary

| Table | Candidate keys | Highest NF | Why not higher |
|---|---|---|---|
| `account` | `{account_id}`, `{username}` | **BCNF** | – |
| `device` | `{device_id}`, `{account_id, device_name}` | **BCNF** | – |
| `song` | `{song_id}` | **BCNF** | – |
| `playback_session` | `{session_id}` | **2NF** | `device_id → account_id` (transitive), a deliberate choice for indexing and locking, made safe with a composite FK. Also the generated column `active_account_id`. |
| `playback_event` | `{event_id}` (+ `{device_id, client_request_id}` over non-NULL rows) | **2NF** | Transitive `device_id → account_id`. Append-only, so there are no update anomalies. |
| `experiment_run` | `{run_id}` | **BCNF** | – |

The design is otherwise fully normalized. Both deviations are in tables where they buy a concrete performance or concurrency property, and both are either enforced (composite FK, generated column) or harmless by construction (append-only log).
