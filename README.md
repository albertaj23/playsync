# PlaySync

Multi-device playback coordination used as a concurrency-control lab on MySQL/InnoDB. The full design is in [`../PLAN.md`](../PLAN.md).

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
npm test                 # vitest against the real Dockerized MySQL (~5 s)
```

The suite covers the schema and seed, every strategy's semantics, 20-way concurrent races (safe strategies never violate the invariant; NAIVE and TXN_RR do), heartbeat fencing (410 PREEMPTED / EXPIRED, with no lease revival), pause/resume/release, idempotency, fault-injection rollback, and the demo endpoints. Tests reset the accounts they use, so they can run while the app is open, but they will end any sessions you have playing on `brij`.

If the database is ever in a strange state, start from a clean one:

```bash
npm run db:reset
```

## The web UI

| Page | What it demonstrates |
|---|---|
| **Overview** `/` | DB health, the invariant, build progress, live schema (tables, row counts, indexes, foreign keys) |
| **Playground** `/playground` | The four `brij` devices as independent clients: claim, pause/resume, stop, the ASK takeover prompt, lease countdown, **Sleep** (stops heartbeats → zombie device), a duplicate-request idempotency test, live strategy/limit/policy controls, the invariant meter and the audit log |
| **Race lab** `/race` | Fires N simultaneous claims under any strategy (pre-acquired connections + barrier), then runs the invariant query. **Run all 6** compares the strategies side by side |

### Demo script (about 3 minutes)

1. **Handoff.** In the Playground, press Play on MacBook, then Play on iPhone. With policy ASK the iPhone asks "Take over?". Confirm it. The MacBook finds out on its next heartbeat (≤ 5 s) and shows "Playback moved to iPhone".
2. **Zombie device.** Play on MacBook, press **Sleep** on it, take over from iPad, wait ~5 s (a heartbeat queues), then **Wake** the MacBook. Its stale heartbeat is fenced: `410 PREEMPTED`.
3. **Lease expiry.** Play on a device, press Sleep and wait 15 s. The session disappears from the server's view and the invariant meter drops to 0; Wake gets `410 EXPIRED`. The lease is never revived.
4. **Idempotency.** Press "Send duplicate claim" on an idle device: two concurrent requests with one id yield one session (see the audit log).
5. **Write skew.** In the Race lab, keep the defaults (30 claims, 1 account, 20 ms window) and press **Run all 6**. NAIVE and TXN_RR grant ~30 streams on a 1-stream account; the other four show 0 violations, and each pays in its own way: SERIALIZABLE in deadlocks, OPTIMISTIC in retries, PESSIMISTIC in queueing.

Switching the live strategy to NAIVE or TXN_RR in the Playground makes the live app unsafe too. That's intentional.

### On a real phone

1. Find your Mac's LAN IP: `ipconfig getifaddr en0`
2. With `npm run dev` running, open `http://<mac-ip>:5173/playground?device=iPhone` on the phone (on the same Wi-Fi). `?device=` shows just that device's panel.
3. Allow the macOS firewall prompt for Node if one appears. Campus Wi-Fi often isolates clients from each other; if the phone can't connect, turn on the phone's hotspot and join it from the Mac.

## Scripts

| Script | What it does |
|---|---|
| `npm run db:up` | Start the MySQL container and wait for it to be healthy |
| `npm run db:down` | Stop the container (data kept) |
| `npm run db:reset` | Drop the volume and re-create the DB from `schema.sql` and `seed.sql` |
| `npm run db:shell` | Open a `mysql` client inside the container |
| `npm run dev` | Start the server (tsx watch) and web (Vite) together |
| `npm test` | Run the server test suite |
| `npm run typecheck` | Run `tsc` on both workspaces |
| `npm run bench` | CLI experiment matrix (Phase 4) |

## Troubleshooting

- **`EADDRINUSE :4000` or `:5173`**: another `npm run dev` is still running. Stop it (Ctrl-C in its terminal) and start again.
- **Web page says "DB unreachable"**: Docker isn't running or the container is down. Run `npm run db:up`.
- **Port 3307 taken**: change `DB_PORT` in `.env`, then run `npm run db:reset`.

## Docs

- [docs/er.md](docs/er.md): ER/EER model, DEVICE specialization and mapping options
- [docs/normalization.md](docs/normalization.md): FDs, candidate keys, 3NF/BCNF analysis, the deliberate denormalization
