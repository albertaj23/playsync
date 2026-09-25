import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { FRIENDLY_STRATEGY, type SimSummary, type StrategyName } from '../../lib/sim';
import { cx, inputCls } from '../ui';

interface RunRef { batchId: string; createdAt: string; strategy: StrategyName; violations: number; p95Ms: number }

const rows: { label: string; get: (s: SimSummary) => string | number; better: 'low' | 'high' }[] = [
  { label: 'Protection', get: (s) => FRIENDLY_STRATEGY[s.config.strategy], better: 'low' },
  { label: 'Times the limit broke', get: (s) => s.kpis.newViolationEvents, better: 'low' },
  { label: 'Worst case over', get: (s) => s.kpis.peakExcess, better: 'low' },
  { label: 'Listeners happy', get: (s) => `${s.kpis.happinessPct}%`, better: 'high' },
  { label: 'Time to play (p95)', get: (s) => `${s.kpis.p95Ms} ms`, better: 'low' },
  { label: 'Songs started', get: (s) => s.kpis.played, better: 'high' },
  { label: 'Tries repeated', get: (s) => s.kpis.retries, better: 'low' },
];

/** Put this run next to any earlier simulation run. */
export function CompareRuns({ current }: { current: SimSummary }) {
  const [list, setList] = useState<RunRef[]>([]);
  const [other, setOther] = useState<SimSummary | null>(null);
  useEffect(() => { api.get<RunRef[]>('/lab/sim/runs').then((r) => r.ok && setList(r.body.filter((x) => x.batchId !== current.batchId))); }, [current.batchId]);
  const pick = async (batchId: string) => {
    if (!batchId) { setOther(null); return; }
    const r = await api.get<SimSummary>(`/lab/sim/runs/${batchId}`);
    if (r.ok) setOther(r.body);
  };
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-stone-700">Compare with…
        <select className={cx(inputCls, 'mt-1')} defaultValue="" onChange={(e) => void pick(e.target.value)}>
          <option value="">Pick an earlier run</option>
          {list.map((r) => <option key={r.batchId} value={r.batchId}>{new Date(r.createdAt).toLocaleTimeString()} · {FRIENDLY_STRATEGY[r.strategy]}</option>)}
        </select>
      </label>
      {other && (
        <div className="overflow-auto rounded-2xl border border-fg/10">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-stone-500"><th className="px-3 py-2">&nbsp;</th><th className="px-3 py-2">This run</th><th className="px-3 py-2">Earlier run</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.label} className="border-t border-fg/8"><td className="px-3 py-2 text-stone-500">{r.label}</td><td className="px-3 py-2 font-semibold text-stone-900">{r.get(current)}</td><td className="px-3 py-2 font-semibold text-stone-900">{r.get(other)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
