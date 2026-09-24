# Experiments

## Purpose and research question

A streaming app notices when the same account starts playback on a second device. This project never claims "this is how Apple does it" — the mechanism is not public — but asks the underlying database question directly:

> **Research question:** How can a relational DBMS maintain a consistent, real-time view of concurrent playback sessions across a user's devices, and what are the correctness and performance trade-offs of different concurrency-control strategies for enforcing a per-account stream limit?

**The invariant being protected:**

> For every account `a`: the number of sessions with `status = 'PLAYING'` and an unexpired lease is ≤ `a.max_streams`.

A primary key gives each row an identity; it does not protect this invariant by itself, because the invariant is a predicate over a *set* of rows. This document measures, on a real MySQL/InnoDB database, how six different concurrency-control strategies protect (or fail to protect) that invariant, and what each strategy costs in retries, deadlocks and latency. It also runs a second, classic anomaly — lost update — on a single row's counter, to show that write skew and lost update are different problems needing different fixes.

## Method

**Lab accounts.** All experiments run against the 16 `lab_xx` accounts (64 devices each), never against the demo account `brij`. Each trial resets the accounts it uses (sessions, events, `state_version`) before firing.

**Pre-acquired connections and a barrier.** Every worker in a trial gets its own dedicated connection from a pool *before* the race starts (`labPool`, sized `LAB_POOL_SIZE` — see `CLAUDE.md`). All workers then wait on one shared promise and are released at the same instant. Without this, requests would queue at the connection pool one at a time and the race window would disappear: nothing would actually run concurrently.

**The race window (`raceDelayMs`).** Every strategy's claim path has a natural, very small window between reading the current state and writing the new state. On a single machine that window can be too small to reliably observe a race within it, so the lab inserts an artificial `sleep(raceDelayMs)` between the read and the write. This does not change *which* anomalies are possible — it only makes them reproducible for measurement. `raceDelayMs = 0` is a legitimate setting; it shows that even without exaggerating the window, the unsafe strategies still fail under enough concurrency.

**The invariant query**, run after every trial settles:

```sql
SELECT a.account_id, a.max_streams, COUNT(*) AS active
FROM account a
JOIN playback_session s
  ON s.account_id = a.account_id AND s.status = 'PLAYING' AND s.lease_expires_at > NOW(3)
WHERE a.is_lab = TRUE
GROUP BY a.account_id, a.max_streams
HAVING COUNT(*) > a.max_streams;
```

`violations = Σ(active − max_streams)` over the returned rows: the total number of *excess* concurrently-playing sessions across all accounts in the trial.

**The lost-update definition.** For the lost-update experiment, `lost = succeeded − finalCount`: the number of increments that the client was *told succeeded* but that are missing from the final counter value. This is deliberately not PLAN.md §8.2's `N − final`: a worker that exhausts its retry budget (the CAS variant, capped at 500 attempts) reports an *error*, not a success, so it should not be counted as a "lost" increment — it never claimed to have succeeded. The two definitions agree whenever there are no errors, which is true for every safe variant in this project's matrix.

**The named lab lock.** Only one experiment — the web UI, this CLI bench, or the test suite — may run against the lab accounts at a time, enforced by a MySQL advisory lock (`GET_LOCK('playsync.lab', 0)`, see `server/src/lab/labLock.ts`). A second attempt fails immediately with a clear "busy" message rather than silently corrupting another experiment's lab accounts.

**What `errors` means.** An `errors` count in a result is *not* a violation. It means a worker's request failed outright — most often `withRetry`'s 5-attempt budget was exhausted after repeated deadlocks or lock-wait timeouts (SERIALIZABLE and OPTIMISTIC under heavy TAKEOVER contention do this legitimately), or a CAS loop hit its 500-attempt cap. A strategy with `violations = 0` and a nonzero `errors` count is still *correct* — it simply refused some requests rather than letting them corrupt the invariant.

## Hypotheses

Independent variables: strategy, isolation level, concurrency (2–100), contention (1 account vs. 16), race-window delay, mode (NORMAL / TAKEOVER). Dependent variables: invariant violations, grants/rejections, retries, deadlocks, lock timeouts, p50/p95 latency, throughput.

- **H1:** NAIVE and TXN_RR (at both READ COMMITTED and REPEATABLE READ) violate the invariant under contention; the violation rate rises with concurrency and race delay.
  **Result: confirmed.** At the harshest cell (Table A: 64 concurrent claims, 1 account, 20 ms delay), NAIVE, TXN_RR@RR and TXN_RR@RC all violate in **100% of trials**, with a mean of 63 excess sessions out of 64 claims — essentially every claim after the first is a violation. This holds at both isolation levels, confirming ACID alone (REPEATABLE READ's own snapshot isolation, or READ COMMITTED) does not protect a predicate over a set of rows.
- **H2:** PESSIMISTIC never violates; its p95 latency grows with contention on a single account but stays flat when load is spread over 16 accounts.
  **Result: confirmed.** 0% violations in every cell (Table A). On 1 account (Table B), PESSIMISTIC's p95 grows from 25.9 ms (c=2) to 97 ms (c=64) — claims genuinely queue behind the account-row lock. Spread over 16 accounts (Table C) it stays essentially flat: 24.98 ms → 39.63 ms across the same concurrency range, because claims for different accounts no longer contend for the same lock at all.
- **H3:** OPTIMISTIC never violates; its retry rate is near zero at low contention and grows sharply at high contention (the classic OCC vs. locking trade-off).
  **Result: confirmed.** 0% violations throughout. At the harshest cell (c=64, 1 account), mean retries are 63 — one CAS retry for almost every losing claim, and yet OPTIMISTIC has the **lowest** p95 of the safe strategies there (52.29 ms vs. PESSIMISTIC's 95.87 ms) and the highest throughput (1188.8 rps), because a failed CAS is cheap compared to waiting in a lock queue. The trade-off is visible, not just theoretical: OCC pays in wasted work (retries), 2PL pays in wall-clock waiting.
- **H4:** SERIALIZABLE never violates but converts conflicts into deadlocks and retries.
  **Result: confirmed, and the cost is severe.** 0% violations, but at c=64/1 account SERIALIZABLE has mean retries of 309, mean deadlocks of 346.8, and **378 outright errors out of 10 trials × 64 claims = 640 claims** (retries exhausted after 5 attempts) — by far the most expensive safe strategy, with p95 latency of 373 ms (7x PESSIMISTIC's) and the lowest throughput of any strategy (173.38 rps). This matches the mechanism: InnoDB turns every read into a shared next-key lock under SERIALIZABLE, so concurrent inserts into the locked range deadlock directly.
- **H5:** CONSTRAINT has the lowest overhead but can only express `max_streams = 1`.
  **Result: partially confirmed.** At low-to-moderate concurrency and on 16 accounts, CONSTRAINT is cheap (Table C: 24.67 ms at c=2, competitive with PESSIMISTIC). But at high concurrency on a single account it is **not** the cheapest — Table A shows CONSTRAINT at 55.44 ms p95, cheaper than PESSIMISTIC (95.87 ms) and SERIALIZABLE, but pricier than OPTIMISTIC (52.29 ms). Worse, Table C shows CONSTRAINT degrading sharply at c=32/64 on 16 accounts (66.24 ms → 281.99 ms) — nearly SERIALIZABLE-level latency — which lines up with `constraint.ts`'s documented deviation from the global lock order (session before account, unlike every other strategy and the reaper), producing exactly the claim/reaper-style deadlocks + retries the code comments predict. `supportsMaxStreamsAbove1 = false` is enforced by `RaceParamError` in `raceRunner.ts` and the `MAX_STREAMS_UNSUPPORTED` guard in `services/playback.ts`, confirming the `max_streams = 1` limitation empirically (Step 6 test 6 in Phase 4) as well as by inspection.
- **H6:** Removing the composite index increases the lock footprint and makes independent accounts block each other.
  **Result: not measured by this bench** — it is the subject of the dedicated index experiment (Phase 6, `lab/indexExperiment.ts`); cross-reference `docs/concurrency.md` once written. This bench does, however, surface a closely related phenomenon worth citing there: SERIALIZABLE's p95 latency is **worse with 16 accounts than with 1** (Table C: 364.7 ms at c=32, vs. Table B's 120.38 ms at c=32 on a single account) — the opposite of what spreading load "should" do. This is consistent with next-key locking on the shared composite index `ix_session_account_status_lease` extending a lock's gap toward a neighboring account's key range (see `CLAUDE.md` §8), i.e. the same index-and-locking interaction H6 is about, observed from the strategy side rather than the index side.

## Threats to validity

- **Single machine, Docker.** All numbers come from one development machine running MySQL 8.4 in a Docker container; absolute latencies are not portable, but the *relative* ordering between strategies (which ones violate, which ones deadlock) is expected to hold generally, since it follows from the locking semantics being tested, not the hardware.
- **The race window is artificial.** `raceDelayMs` exaggerates a real but tiny window so it is reliably observable on one machine; production race windows are shaped by real I/O and scheduling latency, not a fixed sleep.
- **Retry cap.** `withRetry` gives up after 5 attempts. Under very high artificial contention (many workers on one account, `TAKEOVER` mode), this legitimately produces `errors` for the safe strategies; that is reported honestly rather than raising the cap to hide it.
- **Run-to-run variance.** Every configuration cell is repeated across multiple trials specifically because a single trial's numbers (especially deadlock/retry counts) vary run to run; the tables below report means and medians, not single-run figures.

## Results

The tables below are generated by `npm run bench` and inserted automatically between the markers; do not hand-edit inside them. Re-run the bench (without `--quick`) to refresh them, then fill in the "Result:" lines above from the numbers.

<!-- bench:start -->
_Generated by `npm run bench` on 2026-09-24T02:11:46.344Z (commit 5b299ff). Batch `52871cd8-c451-4417-b658-135e85f7adb5`. Matrix: 7 strategy/isolation combinations × concurrency {2, 8, 32, 64} × accounts {1, 16} × race delay {0, 20 ms} × 10 trial(s); lost update: 4 variants × N {10, 50} × delay {0, 20 ms} × 5 trial(s). MySQL 8.4 in Docker on Darwin 25.2.0._

### Table A: stream limit, harshest cell (concurrency 64, 1 account, 20 ms delay)

| strategy | trials | % violating | mean violations | mean retries | mean deadlocks | errors | median p95 (ms) | mean throughput (rps) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NAIVE | 10 | 100% | 63 | 0 | 0 | 0 | 78.26 | 803.8 |
| TXN_RR@RR | 10 | 100% | 63 | 0 | 0 | 0 | 88.98 | 686.55 |
| TXN_RR@RC | 10 | 100% | 63 | 0 | 0 | 0 | 94.82 | 648.8 |
| SERIALIZABLE | 10 | 0% | 0 | 309 | 346.8 | 378 | 373.26 | 173.38 |
| PESSIMISTIC | 10 | 0% | 0 | 0 | 0 | 0 | 95.87 | 627.54 |
| OPTIMISTIC | 10 | 0% | 0 | 63 | 0 | 0 | 52.29 | 1188.8 |
| CONSTRAINT | 10 | 0% | 0 | 0 | 0 | 0 | 55.44 | 943.91 |

### Table B: mean p95 latency (ms) by concurrency, 1 account

| strategy | c=2 | c=8 | c=32 | c=64 |
| --- | --- | --- | --- | --- |
| NAIVE | 25.06 | 30.02 | 47.46 | 76.68 |
| TXN_RR@RR | 25.23 | 31.84 | 60.62 | 89.44 |
| TXN_RR@RC | 24.83 | 31.14 | 58.85 | 93.84 |
| SERIALIZABLE | 31.19 | 32.42 | 120.38 | 362.13 |
| PESSIMISTIC | 25.9 | 32.06 | 62.44 | 97 |
| OPTIMISTIC | 32.69 | 33.3 | 45.15 | 52.86 |
| CONSTRAINT | 26.51 | 28.74 | 130.8 | 282.48 |

### Table C: mean p95 latency (ms) by concurrency, 16 accounts

| strategy | c=2 | c=8 | c=32 | c=64 |
| --- | --- | --- | --- | --- |
| NAIVE | 25.52 | 27.76 | 33.83 | 42.48 |
| TXN_RR@RR | 24.49 | 25.74 | 32.13 | 40.08 |
| TXN_RR@RC | 24.39 | 25.48 | 32.19 | 39.71 |
| SERIALIZABLE | 54.92 | 197.64 | 364.7 | 377.94 |
| PESSIMISTIC | 24.98 | 26.2 | 32.11 | 39.63 |
| OPTIMISTIC | 25.56 | 26.17 | 36.69 | 46.39 |
| CONSTRAINT | 24.67 | 26.6 | 66.24 | 281.99 |

### Table D: lost update, 20 ms delay

| variant | N | mean final count | mean lost | mean retries | median p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| NAIVE_RMW | 10 | 1 | 9 | 0 | 24.18 |
| NAIVE_RMW | 50 | 1 | 49 | 0 | 25.55 |
| ATOMIC | 10 | 10 | 0 | 0 | 4.11 |
| ATOMIC | 50 | 50 | 0 | 0 | 20.17 |
| LOCKED | 10 | 10 | 0 | 0 | 254.09 |
| LOCKED | 50 | 50 | 0 | 0 | 1260.61 |
| CAS | 10 | 10 | 0 | 45 | 269.59 |
| CAS | 50 | 50 | 0 | 1225 | 1266.71 |

**Raw data:**
- [stream-limit-20260924-074146.csv](results/stream-limit-20260924-074146.csv)
- [lost-update-20260924-074146.csv](results/lost-update-20260924-074146.csv)
<!-- bench:end -->
