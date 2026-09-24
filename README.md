# PlaySync

Multi-device playback coordination used as a concurrency-control lab on MySQL/InnoDB. The full design is in [docs/PLAN.md](docs/PLAN.md); how the build deviates from it, and how to work on it, is in [CLAUDE.md](CLAUDE.md).

Everything runs locally and for free: MySQL 8.4 in Docker, Node 20+, React. There is no authentication. You pick an account by username, because login is out of scope for this project.

## Prerequisites

- **Node.js 20+** and npm
- **Docker Desktop** (running)

## Build and run

```bash
cp .env.example .env     # skip if .env already exists
npm install              # installs both workspaces (server, web)
npm run db:up            # starts MySQL 8.4, applies db/schema.sql + db/seed.sql, waits until healthy
npm run dev              # API on :4000, web UI on :5173 (both bound to the LAN)
```

Then open **http://localhost:5173**.

MySQL is published on host port **3307** (`DB_PORT` in `.env`) so it doesn't collide with a locally installed MySQL on 3306. The same variable drives both `docker-compose.yml` and the server.

To check that everything compiles, or to produce a production build of the UI:

```bash
npm run typecheck        # tsc on server + web
npm -w web run build     # static bundle in web/dist
```

## Test

```bash
npm test                 # server suite against the real Dockerized MySQL, then web unit tests (~45 s)
npm -w server run test:fast   # everything except the slow Concurrency Lab tests (~6 s)
```

The server suite covers the schema and seed, every strategy's semantics, 20-way concurrent races (safe strategies never violate the invariant; NAIVE and TXN_RR do), heartbeat fencing (410 PREEMPTED / EXPIRED, with no lease revival), pause/resume/release, idempotency, fault-injection rollback, real-time pushes (published only after commit; a taken-over device is told immediately), the lease reaper, the live correctness checks (each one shown failing when its property is broken), and the **Concurrency Lab** (20 trials × 50-way races per safe strategy, TAKEOVER mode, persistence, guards, the lab lock, and all four lost-update variants). The web suite tests the versioned store that discards out-of-order pushes. Tests reset the accounts they use, so they can run while the app is open, but they will end any sessions you have playing on `brij`, and they'll wait for any other experiment (the UI, the CLI bench) holding the lab lock to finish first.

If the database is ever in a strange state, start from a clean one:

```bash
npm run db:reset
```

## The web UI

| Page | What it demonstrates |
|---|---|
| **Home** `/` | What the app does, in plain language, and where to go next |
| **My devices** `/devices` | The four `brij` devices, each an independent live client: play, pause/resume, stop, the “Play here instead?” prompt, **Go offline**, and plain-language settings (how many devices may play, what happens when a new one starts) |
| **Single device** `/device` | One device on its own, for opening on a real phone |
| **Stress test** `/stress` | Two experiments, switchable at the top. **Pressing Play together**: N devices press Play at once under a chosen protection method; **Counting plays**: N people finish a song at once and a play counter is (or isn't) updated correctly. Either way: a verdict, and **Compare all** runs every method |
| **Stats for nerds** `/nerds` | What the friendly pages hide, in seven tabs: **Checks** (six SQL assertions re-run after every change, with history), **Lab** (full-control Concurrency Lab: pick strategies/variants, parameters and trial counts directly, saved to the database), **Action trace** (every request and response from any tab), **Live state** (sessions, leases, versions, live strategy switch), **Audit log**, **Experiment runs** (every trial ever saved to `experiment_run`, filterable by batch/experiment/accounts/delay, with charts built from the database), **Database** (schema, indexes, foreign keys) |

### Demo script (about 3 minutes)

1. **Handoff.** In My devices, press Play on MacBook, then Play on iPhone. The iPhone asks “Play here instead?”. Confirm it, and the MacBook stops instantly with “Playback moved to iPhone.”
2. **Zombie device.** Play on MacBook, press **Go offline** on it, take over from iPad, wait ~6 s, then **Back online** on MacBook. It learns the news only now (its late heartbeat is refused) and says the music moved while it was offline.
3. **Lease expiry.** Play on a device, press Go offline and wait 20 s. The server lets the stream go (the reaper marks it expired within ~2 s of the lease lapsing); Back online says the device was offline too long. The lease is never revived.
4. **Proof.** Open **Stats for nerds** in a second tab while you do the above. Every click shows up in the Action trace, and the Checks tab re-verifies the database after each one. Use its “Send duplicate request” probe to see idempotency.
5. **Write skew.** In the Stress test (Pressing Play together), keep the defaults and press **Compare all**. “No protection” and “Basic grouping” (NAIVE, TXN_RR) let ~30 devices play on a 1-device account; the other four hold the limit. Stats for nerds → Experiment runs shows what each one paid in retries, deadlocks and latency, read straight from `experiment_run`.
6. **Lost update.** Switch the Stress test to **Counting plays** and press **Compare all**. “Read, then write” loses most of the plays; the other three variants always land on exactly N.

Switching the live strategy to NAIVE or TXN_RR (Stats for nerds → Live state) makes the live app unsafe too. That's intentional. Stats for nerds → **Lab** gives full control over both experiments (every strategy/variant, custom concurrency, accounts, trials) for deeper digging, and `npm run bench` runs the whole matrix from the command line and writes `docs/experiments.md` + CSVs in `docs/results/`.

### On a real phone

1. Find your Mac's LAN IP: `ipconfig getifaddr en0`
2. With `npm run dev` running, open `http://<mac-ip>:5173/device?account=brij&device=iPhone` on the phone (on the same Wi-Fi).
3. Allow the macOS firewall prompt for Node if one appears. Campus Wi-Fi often isolates clients from each other; if the phone can't connect, turn on the phone's hotspot and join it from the Mac.

## Scripts

| Script | What it does |
|---|---|
| `npm run db:up` | Start the MySQL container and wait for it to be healthy |
| `npm run db:down` | Stop the container (data kept) |
| `npm run db:reset` | Drop the volume and re-create the DB from `schema.sql` and `seed.sql` |
| `npm run db:shell` | Open a `mysql` client inside the container |
| `npm run dev` | Start the server (tsx watch) and web (Vite) together |
| `npm test` | Run the server and web test suites |
| `npm -w server run test:fast` | Server tests, skipping the slow Concurrency Lab tests |
| `npm run typecheck` | Run `tsc` on both workspaces |
| `npm run bench` | Full experiment matrix (~1200 trials, several minutes): writes CSVs to `docs/results/` and updates `docs/experiments.md` |
| `npm run bench -- --quick` | A fast smoke test of the same pipeline (~1 minute) |
| `npm run bench -- --trials N` | Override the trial count |
| `npm run bench -- --only stream\|lost` | Run just one of the two experiments |
| `npm run bench -- --no-md` | Skip updating `docs/experiments.md` |

## Troubleshooting

- **`EADDRINUSE :4000` or `:5173`**: another `npm run dev` is still running. Stop it (Ctrl-C in its terminal) and start again.
- **Web page says "DB unreachable"**: Docker isn't running or the container is down. Run `npm run db:up`.
- **Port 3307 taken**: change `DB_PORT` in `.env`, then run `npm run db:reset`.

## Docs

- [docs/PLAN.md](docs/PLAN.md): the original specification
- [CLAUDE.md](CLAUDE.md): project guide for coding agents (status, rules, deviations from the plan, workflow)
- [docs/implementation/phase-4.md](docs/implementation/phase-4.md), [docs/implementation/phases-5-7.md](docs/implementation/phases-5-7.md): implementation plans for the remaining phases
- [docs/er.md](docs/er.md): ER/EER model, DEVICE specialization and mapping options
- [docs/normalization.md](docs/normalization.md): FDs, candidate keys, 3NF/BCNF analysis, the deliberate denormalization
- [docs/experiments.md](docs/experiments.md): research question, method, hypotheses, and the bench-generated results tables; `docs/results/` holds the raw per-trial CSVs
