# PlaySync

Multi-device playback coordination used as a concurrency-control lab on MySQL/InnoDB. The full design is in [`../PLAN.md`](../PLAN.md).

Everything runs locally and for free: MySQL 8.4 in Docker, Node 20+, React. There is no authentication. You pick an account by username, because login is out of scope for this project.

## Setup

```bash
cp .env.example .env     # already done if .env exists
npm install
npm run db:up            # starts MySQL 8.4, applies db/schema.sql + db/seed.sql, waits until healthy
npm test                 # vitest against the real database
npm run dev              # API on :4000, web on :5173 (both bound to the LAN)
```

MySQL is published on host port **3307** (`DB_PORT` in `.env`) so it doesn't collide with a locally installed MySQL on 3306. The same variable drives both `docker-compose.yml` and the server.

| Script | What it does |
|---|---|
| `npm run db:up` | Start the MySQL container and wait for it to be healthy |
| `npm run db:reset` | Drop the volume and re-create the DB from `schema.sql` and `seed.sql` |
| `npm run db:shell` | Open a `mysql` client inside the container |
| `npm run dev` | Start the server (tsx watch) and web (Vite) together |
| `npm test` | Run the server test suite |
| `npm run typecheck` | Run `tsc` on both workspaces |
| `npm run bench` | CLI experiment matrix (Phase 4) |

## Docs

- [docs/er.md](docs/er.md): ER/EER model, DEVICE specialization and mapping options
- [docs/normalization.md](docs/normalization.md): FDs, candidate keys, 3NF/BCNF analysis, the deliberate denormalization
