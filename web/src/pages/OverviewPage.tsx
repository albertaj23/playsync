import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AppConfig, type Health, type Overview } from '../lib/api';
import { Badge, Card, Code, Dot, Stat, cx } from '../components/ui';

const PHASES = [
  { n: 0, title: 'Scaffold', detail: 'Workspaces, Docker MySQL 8.4, config, /api/health', done: true },
  { n: 1, title: 'Schema & seed', detail: '6 tables, composite FK, recursive-CTE seed, ER + normalization docs', done: true },
  { n: 2, title: 'Strategies & playback', detail: '6 claim strategies, leases, fencing, idempotency, fault injection', done: true },
  { n: 3, title: 'Real-time & reaper', detail: 'socket.io push, lease reaper, /device and /wall', done: false },
  { n: 4, title: 'Concurrency lab', detail: 'Trials, experiment_run, charts, lost-update, CLI bench', done: false },
  { n: 5, title: 'Transaction stepper', detail: 'Two live transactions, data_locks, deadlocks, KILL', done: false },
  { n: 6, title: 'Index lab & docs', detail: 'EXPLAIN, lock footprint, concurrency + syllabus docs', done: false },
];

const TABLE_NOTES: Record<string, string> = {
  account: 'Parent row = per-account lock target. state_version drives OCC and client ordering.',
  device: 'EER specialization via device_type. (device_id, account_id) is UNIQUE so it can be an FK target.',
  song: 'Made-up catalogue. play_count is the lost-update experiment target.',
  playback_session: 'Deliberately 2NF: account_id copied from device, kept honest by a composite FK.',
  playback_event: 'Append-only audit log. No FKs by design; (device_id, client_request_id) gives idempotency.',
  experiment_run: 'One row per lab trial (filled from Phase 4).',
};

export default function OverviewPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);

  useEffect(() => {
    api.get<Health>('/health').then((r) => setHealth(r.body)).catch((e: Error) => setHealth({ ok: false, error: e.message }));
    api.get<AppConfig>('/config').then((r) => r.ok && setCfg(r.body)).catch(() => undefined);
    api.get<Overview>('/db/overview').then((r) => r.ok && setOv(r.body)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <Badge tone="indigo">DBMS coursework · concurrency-control lab</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            One account, many devices,<br />one stream.
          </h1>
          <p className="mt-3 max-w-xl text-zinc-400">
            How can a relational DBMS keep a consistent, real-time view of concurrent playback sessions across a user&apos;s
            devices, and what does each concurrency-control strategy cost?
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/playground" className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">Open playground →</Link>
            <Link to="/race" className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700 hover:bg-zinc-700">Run a race</Link>
          </div>
        </div>
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">The invariant</div>
          <p className="mt-2 font-mono text-sm leading-relaxed text-zinc-100">
            ∀ account a:<br />
            |{'{'} s ∈ session : s.account = a<br />
            &nbsp;&nbsp;∧ s.status = &apos;PLAYING&apos;<br />
            &nbsp;&nbsp;∧ s.lease_expires_at &gt; NOW(3) {'}'}|<br />
            &nbsp;&nbsp;≤ a.max_streams
          </p>
          <p className="mt-3 text-xs text-zinc-400">
            It&apos;s a predicate over a <em>set</em> of rows, so a primary key can&apos;t protect it. Two devices that both read
            &quot;0 active&quot; and both insert produce <strong className="text-zinc-200">write skew</strong>, not a lost update.
          </p>
        </div>
      </div>

      {/* Live system */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Database"
          value={health === null ? '…' : health.ok ? `MySQL ${health.db?.version}` : 'offline'}
          tone={health === null ? undefined : health.ok ? 'green' : 'red'}
          hint={health?.ok ? `schema “${health.db?.name}”` : health?.error ?? 'checking'}
        />
        <Stat label="Default isolation" value={health?.db?.defaultIsolation?.replace('-', ' ') ?? '…'} hint="InnoDB server default" />
        <Stat label="Live strategy" value={cfg?.strategy ?? '…'} hint="switch it in the playground" />
        <Stat label="Lease / heartbeat" value={cfg ? `${cfg.leaseMs / 1000}s / ${cfg.heartbeatMs / 1000}s` : '…'} hint="judged by the DB clock" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* Phases */}
        <Card title="Build progress" subtitle="Each phase stops for review">
          <ol className="space-y-3">
            {PHASES.map((p) => (
              <li key={p.n} className="flex gap-3">
                <div className={cx(
                  'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  p.done ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40' : 'bg-zinc-800 text-zinc-500',
                )}>
                  {p.done ? '✓' : p.n}
                </div>
                <div>
                  <div className={cx('text-sm font-medium', p.done ? 'text-zinc-100' : 'text-zinc-500')}>Phase {p.n}: {p.title}</div>
                  <div className="text-xs text-zinc-500">{p.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        {/* Schema */}
        <Card
          title="Schema & seed data"
          subtitle="Read live from information_schema"
          action={ov && (
            <div className="flex gap-1.5">
              <Badge>{ov.accounts.demo} demo</Badge>
              <Badge>{ov.accounts.lab} lab</Badge>
              <Badge>{ov.accounts.stepper} stepper</Badge>
            </div>
          )}
        >
          {!ov ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {ov.tables.map((t) => (
                <div key={t.name} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3.5">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-sm font-semibold text-zinc-100">{t.name}</span>
                    <span className="text-xs tabular-nums text-zinc-400">{t.rows.toLocaleString()} rows</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{TABLE_NOTES[t.name]}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {t.indexes.map((i) => (
                      <Badge key={i.name} tone={i.name === 'PRIMARY' ? 'indigo' : i.unique ? 'sky' : 'zinc'}>
                        <span title={i.columns}>{i.name === 'PRIMARY' ? `PK(${i.columns})` : i.name}</span>
                      </Badge>
                    ))}
                  </div>
                  {t.foreignKeys.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {t.foreignKeys.map((f) => (
                        <li key={f.name} className="font-mono text-[11px] text-zinc-400">
                          <span className="text-amber-300/90">FK</span> ({f.columns}) → {f.refTable}({f.refColumns})
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.name === 'playback_session' && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <Dot tone={t.indexes.some((i) => i.name === 'uq_one_active_per_account') ? 'green' : 'zinc'} />
                      <Code>uq_one_active_per_account</Code> exists only while CONSTRAINT is in use
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
