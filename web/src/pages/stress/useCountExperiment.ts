import { useState } from 'react';
import { api, type ErrorBody, type LostUpdateResponse, type LostUpdateResult, type LostUpdateVariant } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { uuid } from '../../lib/uuid';
import type { Lane } from '../../components/RaceTrack';
import type { Experiment, ResultView } from './experiment';
import { friendlyError, LOST_UPDATE_METHODS, luLabelOf, luVerdict } from './methods';

export function useCountExperiment(): Experiment {
  const [method, setMethod] = useState<LostUpdateVariant>('NAIVE_RMW');
  const [people, setPeople] = useState(50);
  const [running, setRunning] = useState<LostUpdateVariant | null>(null);
  const [result, setResult] = useState<LostUpdateResult | null>(null);
  const [comparison, setComparison] = useState<LostUpdateResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const toast = useToast();

  // /lab/lost-update always runs a batch of trials (1 here) and returns { batchId, trials, aggregate }.
  async function runOne(variant: LostUpdateVariant, batchId?: string): Promise<LostUpdateResult | null> {
    setRunning(variant);
    const r = await api.post<LostUpdateResponse & ErrorBody>('/lab/lost-update', { variant, increments: people, raceDelayMs: 20, trials: 1, batchId });
    if (!r.ok) { const m = friendlyError(r.status, r.body.message); setError(m); toast(m, 'warn'); return null; }
    return r.body.trials[0] ?? null;
  }

  const run = async () => {
    setError(null); setComparison([]);
    const r = await runOne(method);
    if (r) setResult(r);
    setRunning(null);
    return !!r;
  };

  const compareAll = async () => {
    setError(null); setResult(null); setComparing(true);
    const batchId = uuid();
    const rows: LostUpdateResult[] = [];
    for (const m of LOST_UPDATE_METHODS) {
      const r = await runOne(m.name, batchId);
      if (r) { rows.push(r); setComparison([...rows]); }
    }
    setRunning(null); setComparing(false);
    return rows.length > 0;
  };

  const view: ResultView | null = result && ({
    ...luVerdict(result), batchId: result.batchId, methodLabel: luLabelOf(result.variant),
    footer: `Method: ${luLabelOf(result.variant)} · finished in ${Math.round(result.wallMs)} ms`,
    dots: [...Array<'ok'>(result.finalCount).fill('ok'), ...Array<'lost'>(result.lost).fill('lost')],
    legend: [{ kind: 'ok', label: 'counted' }, { kind: 'lost', label: 'lost' }],
  } as ResultView);

  const lanes: Lane[] = LOST_UPDATE_METHODS.map((m) => {
    const r = comparison.find((c) => c.variant === m.name);
    if (!r) return { key: m.name, label: m.label, state: running === m.name ? 'running' : 'waiting' };
    const cv = luVerdict(r);
    return { key: m.name, label: m.label, state: 'done', ok: cv.ok, badge: cv.ok ? 'accurate' : 'lost plays',
      detail: `counter says ${r.finalCount} of ${r.succeeded} · ${Math.round(r.wallMs)} ms` };
  });

  return {
    kind: 'count', amount: people, setAmount: setPeople, amountLabel: 'People finishing a song at once',
    methods: LOST_UPDATE_METHODS, method, setMethod: (m) => setMethod(m as LostUpdateVariant), methodBlocked: null,
    running, comparing, error, result: view, lanes, comparisonBatch: comparison[0]?.batchId, hasComparison: comparison.length > 0 || comparing, run, compareAll,
  };
}
