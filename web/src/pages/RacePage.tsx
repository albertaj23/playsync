import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type ErrorBody, type RaceParams, type RaceResult, type StrategyName } from '../lib/api';
import { Badge, Button, Card, Code, Field, Stat, cx, inputCls } from '../components/ui';

const STRATEGY_INFO: Record<StrategyName, { iso: string; how: string; expect: string; safe: boolean }> = {
  NAIVE: { iso: 'autocommit', how: 'COUNT → sleep → INSERT, no transaction', expect: 'violations', safe: false },
  TXN_RR: { iso: 'REPEATABLE READ', how: 'Same statements inside BEGIN … COMMIT', expect: 'still violations: snapshot reads don’t lock', safe: false },
  SERIALIZABLE: { iso: 'SERIALIZABLE', how: 'Reads become shared next-key locks', expect: '0 violations, deadlocks + retries', safe: true },
  PESSIMISTIC: { iso: 'READ COMMITTED', how: 'SELECT … FOR UPDATE on the account row first', expect: '0 violations, claims queue', safe: true },
  OPTIMISTIC: { iso: 'READ COMMITTED', how: 'Read version, then CAS UPDATE … WHERE state_version = v', expect: '0 violations, retries rise with contention', safe: true },
  CONSTRAINT: { iso: 'READ COMMITTED', how: 'UNIQUE index on a generated column; 1062 = taken', expect: '0 violations, max_streams = 1 only', safe: true },
};
const ORDER: StrategyName[] = ['NAIVE', 'TXN_RR', 'SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT'];

type Row = RaceResult & { id: number };

export default function RacePage() {
  const [params, setParams] = useState<RaceParams>({
    strategy: 'NAIVE', concurrency: 30, accounts: 1, maxStreams: 1, raceDelayMs: 20, mode: 'NORMAL',
  });
  const [isolation, setIsolation] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [comparison, setComparison] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RaceParams>(k: K, v: RaceParams[K]) => setParams((p) => ({ ...p, [k]: v }));

  async function runOne(strategy: StrategyName): Promise<Row | null> {
    setRunning(strategy);
    const body = { ...params, strategy, ...(isolation && strategy === params.strategy ? { isolation } : {}) };
    const r = await api.post<RaceResult & ErrorBody>('/lab/race', body);
    if (!r.ok) { setError(r.body.message ?? `Error ${r.status}`); return null; }
    const row = { ...r.body, id: Date.now() + Math.random() };
    setHistory((h) => [row, ...h].slice(0, 30));
    return row;
  }

  async function run() {
    setError(null);
    await runOne(params.strategy);
    setRunning(null);
  }

  async function runAll() {
    setError(null);
    const rows: Row[] = [];
    for (const s of ORDER) {
      if (s === 'CONSTRAINT' && params.maxStreams > 1) continue;
      const row = await runOne(s);
      if (row) { rows.push(row); setComparison([...rows]); }
    }
    setRunning(null);
  }

  const latest = history[0];
  const info = STRATEGY_INFO[params.strategy];
  const constraintBlocked = params.strategy === 'CONSTRAINT' && params.maxStreams > 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Race lab</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Fires N claims from N different devices at the same instant (pre-acquired connections released by a barrier), then runs the
          invariant query. Uses the 16 <Code>lab_xx</Code> accounts, which are reset before every run. Single-trial preview; Phase 4
          adds trials, persistence and the full charts.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Form */}
        <Card title="Experiment">
          <div className="space-y-4">
            <Field label="Strategy">
              <select className={inputCls} value={params.strategy} onChange={(e) => set('strategy', e.target.value as StrategyName)}>
                {ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="rounded-lg bg-zinc-950/60 p-3 text-xs ring-1 ring-zinc-800">
              <div className="flex items-center justify-between">
                <span className="font-mono text-zinc-400">{info.iso}</span>
                <Badge tone={info.safe ? 'green' : 'red'}>{info.safe ? 'safe' : 'unsafe'}</Badge>
              </div>
              <div className="mt-1.5 text-zinc-300">{info.how}</div>
              <div className="mt-1 text-zinc-500">Expected: {info.expect}</div>
            </div>
            <Field label={`Concurrency: ${params.concurrency} simultaneous claims`}>
              <input type="range" min={2} max={100} value={params.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} className="w-full accent-indigo-400" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Accounts" hint="1 = max contention">
                <select className={inputCls} value={params.accounts} onChange={(e) => set('accounts', Number(e.target.value))}>
                  {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="Max streams">
                <select className={inputCls} value={params.maxStreams} onChange={(e) => set('maxStreams', Number(e.target.value))}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="Race window" hint="sleep between check & write">
                <select className={inputCls} value={params.raceDelayMs} onChange={(e) => set('raceDelayMs', Number(e.target.value))}>
                  {[0, 5, 20, 50].map((n) => <option key={n} value={n}>{n} ms</option>)}
                </select>
              </Field>
              <Field label="Mode">
                <select className={inputCls} value={params.mode} onChange={(e) => set('mode', e.target.value as RaceParams['mode'])}>
                  <option value="NORMAL">NORMAL</option>
                  <option value="TAKEOVER">TAKEOVER</option>
                </select>
              </Field>
            </div>
            <Field label="Isolation override" hint="e.g. TXN_RR at READ COMMITTED">
              <select className={inputCls} value={isolation} onChange={(e) => setIsolation(e.target.value)}>
                <option value="">strategy default</option>
                {['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            {constraintBlocked && <p className="text-xs text-amber-300">CONSTRAINT can only express max_streams = 1.</p>}
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={run} disabled={!!running || constraintBlocked}>
                {running ? `Running ${running}…` : 'Run race'}
              </Button>
              <Button className="flex-1" onClick={() => { setComparison([]); void runAll(); }} disabled={!!running}>
                Run all 6
              </Button>
            </div>
          </div>
        </Card>

        {/* Latest */}
        <div className="space-y-4">
          <Card
            title={latest ? `Latest: ${latest.strategy}` : 'Latest run'}
            subtitle={latest ? `${latest.concurrency} claims · ${latest.accounts} account(s) · max ${latest.maxStreams} · ${latest.raceDelayMs} ms window · ${latest.mode} · ${latest.isolationUsed}` : 'Run a race to see results'}
            action={running && <Badge tone="indigo">running {running}…</Badge>}
          >
            {latest ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Violations" value={latest.violations} tone={latest.violations ? 'red' : 'green'} hint="excess active sessions" />
                <Stat label="Granted / rejected" value={`${latest.granted} / ${latest.rejected}`} hint={latest.errors ? `${latest.errors} failed (${latest.errorSamples.join(', ')})` : 'no errors'} tone={latest.errors ? 'amber' : undefined} />
                <Stat label="Deadlocks / retries" value={`${latest.deadlocks} / ${latest.retries}`} hint={latest.lockTimeouts ? `${latest.lockTimeouts} lock timeouts` : 'InnoDB victims, withRetry'} />
                <Stat label="p50 / p95" value={`${latest.p50Ms} / ${latest.p95Ms}`} hint={`ms · ${latest.throughputRps} claims/s`} />
              </div>
            ) : (
              <div className="grid place-items-center py-10 text-sm text-zinc-500">
                Try NAIVE first: with 30 devices and a 20 ms window nearly every claim is granted.
              </div>
            )}
          </Card>

          {comparison && comparison.length > 0 && (
            <Card title="Strategy comparison" subtitle="Same parameters, one run each">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="h-64">
                  <div className="mb-2 text-xs font-medium text-zinc-400">Correctness vs. cost</div>
                  <ResponsiveContainer>
                    <BarChart data={comparison} margin={{ left: -20, right: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#27272a" vertical={false} />
                      <XAxis dataKey="strategy" tick={{ fill: '#a1a1aa', fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: '#71717a', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#27272a55' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="violations" fill="#fb7185" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="deadlocks" fill="#fbbf24" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="retries" fill="#818cf8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-64">
                  <div className="mb-2 text-xs font-medium text-zinc-400">Latency (ms)</div>
                  <ResponsiveContainer>
                    <BarChart data={comparison} margin={{ left: -20, right: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#27272a" vertical={false} />
                      <XAxis dataKey="strategy" tick={{ fill: '#a1a1aa', fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#27272a55' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="p50Ms" name="p50" fill="#34d399" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="p95Ms" name="p95" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card title="Run history" subtitle="This browser session only (persisted runs arrive in Phase 4)" action={history.length > 0 && <Button variant="ghost" onClick={() => { setHistory([]); setComparison(null); }}>Clear</Button>}>
        {history.length === 0 ? (
          <div className="text-sm text-zinc-500">No runs yet.</div>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-zinc-500">
                <tr className="border-b border-zinc-800">
                  {['strategy', 'isolation', 'N', 'accts', 'max', 'window', 'mode', 'granted', 'rejected', 'errors', 'deadlocks', 'retries', 'violations', 'p95 ms'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium first:pl-5 last:pr-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 font-mono">
                {history.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-800/30">
                    <td className="px-3 py-2 pl-5 font-sans font-medium text-zinc-200">{r.strategy}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.isolationUsed}</td>
                    <td className="px-3 py-2">{r.concurrency}</td>
                    <td className="px-3 py-2">{r.accounts}</td>
                    <td className="px-3 py-2">{r.maxStreams}</td>
                    <td className="px-3 py-2">{r.raceDelayMs}</td>
                    <td className="px-3 py-2">{r.mode}</td>
                    <td className="px-3 py-2">{r.granted}</td>
                    <td className="px-3 py-2">{r.rejected}</td>
                    <td className={cx('px-3 py-2', r.errors ? 'text-amber-300' : '')}>{r.errors}</td>
                    <td className="px-3 py-2">{r.deadlocks}</td>
                    <td className="px-3 py-2">{r.retries}</td>
                    <td className={cx('px-3 py-2 font-semibold', r.violations ? 'text-rose-300' : 'text-emerald-300')}>{r.violations}</td>
                    <td className="px-3 py-2 pr-5">{r.p95Ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
