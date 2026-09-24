import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import type { TraceEntry } from '../../lib/trace';
import type { RaceResult } from '../../lib/api';
import { Card } from '../ui';

export function StressTab({ trace }: { trace: TraceEntry[] }) {
  const runs = trace
    .filter((t) => t.path === '/lab/race' && t.status === 200)
    .map((t) => ({ at: t.at, result: t.response as RaceResult }));

  if (runs.length === 0) {
    return (
      <Card padded>
        <p className="text-sm text-stone-600">
          Runs from the <Link to="/stress" className="font-medium text-violet-700 hover:underline">Stress test</Link> page appear here.
        </p>
      </Card>
    );
  }

  // Get the latest run of each strategy
  const latestByStrategy = new Map<string, typeof runs[0]>();
  for (const r of runs.slice().reverse()) { // Reverse to go oldest to newest, so newer overwrites older
    latestByStrategy.set(r.result.strategy, r);
  }
  const chartData = Array.from(latestByStrategy.values()).map(r => r.result);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Correctness vs. cost" subtitle="latest run per strategy" className="h-80" padded={false}>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis dataKey="strategy" tick={{ fontSize: 10, fill: '#78716c' }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#78716c' }} width={40} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                <Bar dataKey="violations" name="violations" fill="#f43f5e" />
                <Bar dataKey="deadlocks" name="deadlocks" fill="#f59e0b" />
                <Bar dataKey="retries" name="retries" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Latency (ms)" subtitle="latest run per strategy" className="h-80" padded={false}>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis dataKey="strategy" tick={{ fontSize: 10, fill: '#78716c' }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#78716c' }} width={40} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                <Bar dataKey="p50Ms" name="p50" fill="#10b981" />
                <Bar dataKey="p95Ms" name="p95" fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="All runs" subtitle="newest first" padded={false}>
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-right font-mono text-[11px] min-w-[900px]">
            <thead className="bg-stone-50 uppercase text-stone-500 sticky top-0 shadow-sm text-left">
              <tr>
                {['time', 'strategy', 'iso', 'conc', 'acc', 'streams', 'delay', 'ok', 'rej', 'err', 'dead', 'retry', 'viol', 'p50', 'p95', 'rps'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium bg-stone-50 ${i < 3 ? 'text-left' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {runs.map((r, i) => {
                const x = r.result;
                const d = new Date(r.at);
                const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
                return (
                  <tr key={i}>
                    <td className="px-3 py-2 text-left text-stone-500">{time}</td>
                    <td className="px-3 py-2 text-left text-stone-900 font-medium">{x.strategy}</td>
                    <td className="px-3 py-2 text-left text-stone-500">{x.isolationUsed || '—'}</td>
                    <td className="px-3 py-2">{x.concurrency}</td>
                    <td className="px-3 py-2">{x.accounts}</td>
                    <td className="px-3 py-2">{x.maxStreams}</td>
                    <td className="px-3 py-2">{x.raceDelayMs}ms</td>
                    <td className="px-3 py-2 text-emerald-600">{x.granted}</td>
                    <td className="px-3 py-2 text-stone-500">{x.rejected}</td>
                    <td className="px-3 py-2 text-rose-500">{x.errors}</td>
                    <td className="px-3 py-2 text-amber-600">{x.deadlocks}</td>
                    <td className="px-3 py-2 text-violet-600">{x.retries}</td>
                    <td className={`px-3 py-2 ${x.violations > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600'}`}>{x.violations}</td>
                    <td className="px-3 py-2">{x.p50Ms}</td>
                    <td className="px-3 py-2">{x.p95Ms}</td>
                    <td className="px-3 py-2 text-sky-600">{x.throughputRps.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      
      <p className="text-xs text-stone-400 text-center">
        Runs are kept in this browser only; Phase 4 stores them in experiment_run.
      </p>
    </div>
  );
}
