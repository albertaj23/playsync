import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Label, LabelList, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type ExperimentRun } from '../../lib/api';
import type { TraceEntry } from '../../lib/trace';
import { Badge, Button, Card, Field, cx, inputCls } from '../ui';

// A stable colour per strategy/variant name, cycling through a small palette for unknown ones.
const PALETTE = ['#7c3aed', '#059669', '#0ea5e9', '#f59e0b', '#f43f5e', '#64748b', '#14b8a6', '#d946ef'];
function colorFor(name: string, known: string[]): string {
  const i = known.indexOf(name);
  return PALETTE[i % PALETTE.length]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });
const shortId = (id: string | null) => (id ? id.slice(0, 8) : '—');

export function RunsTab({ trace }: { trace: TraceEntry[] }) {
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [loading, setLoading] = useState(false);

  const experiment = (params.get('experiment') as 'STREAM_LIMIT' | 'LOST_UPDATE' | null) ?? 'STREAM_LIMIT';
  const batch = params.get('batch') ?? '';
  const accountsFilter = params.get('accounts') ?? '';
  const delayFilter = params.get('delay') ?? '';

  async function refresh() {
    setLoading(true);
    const r = await api.get<ExperimentRun[]>(`/lab/runs?experiment=${experiment}&limit=500`);
    if (r.ok) setRuns(r.body);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [experiment]);

  // Any /lab/* trace entry means a new run may exist in the database; refetch after a short delay.
  useEffect(() => {
    const latest = trace[0];
    if (!latest || !latest.path?.startsWith('/lab/')) return;
    const t = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace[0]?.id]);

  const setParam = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });

  const batches = useMemo(() => {
    const byBatch = new Map<string, { batchId: string; at: string; strategies: Set<string> }>();
    for (const r of runs) {
      if (!r.batchId) continue;
      const b = byBatch.get(r.batchId) ?? { batchId: r.batchId, at: r.createdAt, strategies: new Set<string>() };
      b.strategies.add(r.strategy);
      byBatch.set(r.batchId, b);
    }
    return [...byBatch.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [runs]);

  const filtered = useMemo(() => runs.filter((r) =>
    (!batch || r.batchId === batch) &&
    (!accountsFilter || String(r.accounts) === accountsFilter) &&
    (!delayFilter || String(r.raceDelayMs) === delayFilter),
  ), [runs, batch, accountsFilter, delayFilter]);

  const strategies = useMemo(() => [...new Set(filtered.map((r) => r.strategy))].sort(), [filtered]);

  const violationsChart = useMemo(() => strategies.map((s) => {
    const rows = filtered.filter((r) => r.strategy === s);
    const withViolations = rows.filter((r) => r.violations > 0).length;
    return { strategy: s, meanViolations: round1(mean(rows.map((r) => r.violations))), pct: Math.round((withViolations / rows.length) * 100) };
  }), [filtered, strategies]);

  const retriesDeadlocksChart = useMemo(() => strategies.map((s) => {
    const rows = filtered.filter((r) => r.strategy === s);
    return { strategy: s, retries: round1(mean(rows.map((r) => r.retries))), deadlocks: round1(mean(rows.map((r) => r.deadlocks))) };
  }), [filtered, strategies]);

  const throughputChart = useMemo(() => strategies.map((s) => {
    const rows = filtered.filter((r) => r.strategy === s);
    return { strategy: s, throughput: round1(mean(rows.map((r) => r.throughputRps))) };
  }), [filtered, strategies]);

  const concurrencies = useMemo(() => [...new Set(filtered.map((r) => r.concurrency))].sort((a, b) => a - b), [filtered]);
  const latencyChart = useMemo(() => concurrencies.map((c) => {
    const row: Record<string, number> = { concurrency: c };
    for (const s of strategies) {
      const rows = filtered.filter((r) => r.concurrency === c && r.strategy === s);
      if (rows.length) row[s] = round1(mean(rows.map((r) => r.p95Ms)));
    }
    return row;
  }), [filtered, strategies, concurrencies]);
  const showLatencyChart = concurrencies.length > 1;

  return (
    <div className="space-y-6">
      <Card title="Filters">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Experiment">
            <select className={inputCls} value={experiment} onChange={(e) => setParam('experiment', e.target.value)}>
              <option value="STREAM_LIMIT">STREAM_LIMIT</option>
              <option value="LOST_UPDATE">LOST_UPDATE</option>
            </select>
          </Field>
          <Field label="Batch">
            <select className={inputCls} value={batch} onChange={(e) => setParam('batch', e.target.value)}>
              <option value="">all</option>
              {batches.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {shortId(b.batchId)} · {time(b.at)} · {[...b.strategies].join(', ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Accounts">
            <select className={inputCls} value={accountsFilter} onChange={(e) => setParam('accounts', e.target.value)}>
              <option value="">any</option>
              {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Race delay">
            <select className={inputCls} value={delayFilter} onChange={(e) => setParam('delay', e.target.value)}>
              <option value="">any</option>
              {[0, 5, 20, 50].map((n) => <option key={n} value={n}>{n} ms</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-stone-500">{filtered.length} of {runs.length} loaded runs match</span>
          <Button size="sm" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">
            No runs yet for these filters. Try the <Link to="/stress" className="font-medium text-violet-700 hover:underline">Stress test</Link> page,
            the Lab tab, or <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs">npm run bench</code>.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Violations by strategy" subtitle="mean per trial, % of trials with a violation" className="h-80" padded={false}>
              <div className="h-64 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={violationsChart} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="strategy" tick={{ fontSize: 10, fill: '#78716c' }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 10, fill: '#78716c' }} width={40} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value, name, p) => (name === 'meanViolations' ? [`${value} (${(p.payload as { pct: number }).pct}% of trials)`, 'mean violations'] : [value, name])}
                    />
                    <Bar dataKey="meanViolations" name="meanViolations" fill="#f43f5e">
                      <LabelList dataKey="pct" position="top" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#78716c' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Retries and deadlocks" subtitle="mean per trial, by strategy" className="h-80" padded={false}>
              <div className="h-64 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={retriesDeadlocksChart} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="strategy" tick={{ fontSize: 10, fill: '#78716c' }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 10, fill: '#78716c' }} width={40} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                    <Bar dataKey="retries" name="retries" fill="#8b5cf6" />
                    <Bar dataKey="deadlocks" name="deadlocks" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {showLatencyChart ? (
              <Card title="p95 latency vs. concurrency" subtitle="one line per strategy" className="h-80" padded={false}>
                <div className="h-64 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={latencyChart} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                      <XAxis dataKey="concurrency" tick={{ fontSize: 10, fill: '#78716c' }}>
                        <Label value="concurrency" position="insideBottom" offset={-15} style={{ fontSize: 10, fill: '#78716c' }} />
                      </XAxis>
                      <YAxis tick={{ fontSize: 10, fill: '#78716c' }} width={40} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                      {strategies.map((s) => (
                        <Line key={s} type="monotone" dataKey={s} name={s} stroke={colorFor(s, strategies)} connectNulls dot={{ r: 3 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ) : (
              <Card title="p95 latency vs. concurrency" className="h-80">
                <div className="grid h-full place-items-center text-center text-sm text-stone-500">
                  <div>
                    These filtered runs only cover one concurrency value.<br />
                    Run <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs">npm run bench</code> to see how latency scales.
                  </div>
                </div>
              </Card>
            )}

            <Card title="Throughput by strategy" subtitle="mean claims/second" className="h-80" padded={false}>
              <div className="h-64 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={throughputChart} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="strategy" tick={{ fontSize: 10, fill: '#78716c' }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 10, fill: '#78716c' }} width={40} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="throughput" name="throughput (rps)" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Runs" subtitle="newest first" padded={false}>
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full min-w-[1100px] text-right font-mono text-[11px]">
                <thead className="sticky top-0 bg-stone-50 text-left uppercase text-stone-500 shadow-sm">
                  <tr>
                    {['run', 'time', 'batch', 'trial', 'src', 'strategy', 'iso', 'conc', 'acc', 'max', 'delay',
                      'ok', 'rej', 'err', 'dead', 'retry', 'viol', 'p50', 'p95', 'rps'].map((h, i) => (
                      <th key={h} className={cx('px-3 py-2 font-medium', i < 6 ? 'text-left' : '')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((r) => (
                    <tr key={r.runId}>
                      <td className="px-3 py-2 text-left text-stone-500">{r.runId}</td>
                      <td className="px-3 py-2 text-left text-stone-500">{time(r.createdAt)}</td>
                      <td className="px-3 py-2 text-left text-stone-500" title={r.batchId ?? ''}>{shortId(r.batchId)}</td>
                      <td className="px-3 py-2 text-left">{r.trial}</td>
                      <td className="px-3 py-2 text-left"><Badge>{r.source}</Badge></td>
                      <td className="px-3 py-2 text-left font-medium text-stone-900">{r.strategy}</td>
                      <td className="px-3 py-2 text-left text-stone-500">{r.isolationLevel}</td>
                      <td className="px-3 py-2">{r.concurrency}</td>
                      <td className="px-3 py-2">{r.accounts}</td>
                      <td className="px-3 py-2">{r.maxStreams}</td>
                      <td className="px-3 py-2">{r.raceDelayMs}ms</td>
                      <td className="px-3 py-2 text-emerald-600">{r.granted}</td>
                      <td className="px-3 py-2 text-stone-500">{r.rejected}</td>
                      <td className="px-3 py-2 text-rose-500">{r.errors}</td>
                      <td className="px-3 py-2 text-amber-600">{r.deadlocks}</td>
                      <td className="px-3 py-2 text-violet-600">{r.retries}</td>
                      <td className={cx('px-3 py-2', r.violations > 0 ? 'font-bold text-rose-600' : 'text-emerald-600')}>{r.violations}</td>
                      <td className="px-3 py-2">{r.p50Ms}</td>
                      <td className="px-3 py-2">{r.p95Ms}</td>
                      <td className="px-3 py-2 text-sky-600">{r.throughputRps.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
