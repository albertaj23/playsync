import { useState } from 'react';
import { api, type ErrorBody, type RaceResult, type StrategyName } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { uuid } from '../../lib/uuid';
import type { Lane } from '../../components/RaceTrack';
import type { Experiment, ResultView } from './experiment';
import { friendlyError, labelOf, METHODS, verdict } from './methods';

export function useStreamExperiment(): Experiment {
  const [method, setMethod] = useState<StrategyName>('NAIVE');
  const [devices, setDevices] = useState(30);
  const [limit, setLimit] = useState(1);
  const [raceDelayMs, setRaceDelayMs] = useState(20);
  const [accounts, setAccounts] = useState(1);
  const [running, setRunning] = useState<StrategyName | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [comparison, setComparison] = useState<RaceResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const toast = useToast();

  async function runOne(name: StrategyName, batchId?: string): Promise<RaceResult | null> {
    setRunning(name);
    const r = await api.post<RaceResult & ErrorBody>('/lab/race',
      { strategy: name, concurrency: devices, maxStreams: limit, raceDelayMs, accounts, mode: 'NORMAL', batchId });
    if (!r.ok) { const m = friendlyError(r.status, r.body.message); setError(m); toast(m, 'warn'); return null; }
    return r.body;
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
    const rows: RaceResult[] = [];
    for (const m of METHODS) {
      if (m.name === 'CONSTRAINT' && limit > 1) continue;
      const r = await runOne(m.name, batchId);
      if (r) { rows.push(r); setComparison([...rows]); }
    }
    setRunning(null); setComparing(false);
    return rows.length > 0;
  };

  const view: ResultView | null = result && (() => {
    const v = verdict(result);
    return {
      ...v, batchId: result.batchId, methodLabel: labelOf(result.strategy),
      footer: `Method: ${labelOf(result.strategy)} · finished in ${Math.round(result.wallMs)} ms`,
      dots: [
        ...Array<'ok'>(result.granted - result.violations).fill('ok'), ...Array<'over'>(result.violations).fill('over'),
        ...Array<'busy'>(result.rejected).fill('busy'), ...Array<'err'>(result.errors).fill('err'),
      ],
      legend: [{ kind: 'ok', label: 'allowed' }, { kind: 'over', label: 'allowed, over the limit' }, { kind: 'busy', label: 'told to wait' }, { kind: 'err', label: 'gave up' }],
    } as ResultView;
  })();

  const lanes: Lane[] = METHODS.filter((m) => !(m.name === 'CONSTRAINT' && limit > 1)).map((m) => {
    const r = comparison.find((c) => c.strategy === m.name);
    if (!r) return { key: m.name, label: m.label, state: running === m.name ? 'running' : 'waiting' };
    const cv = verdict(r);
    return { key: m.name, label: m.label, state: 'done', ok: cv.ok, badge: cv.ok ? 'protected' : 'broken',
      detail: `${r.granted} played · ${r.rejected} told to wait${r.errors ? ` · ${r.errors} gave up` : ''} · ${Math.round(r.wallMs)} ms` };
  });

  return {
    kind: 'stream', amount: devices, setAmount: setDevices, amountLabel: 'Screens pressing Play at once',
    limit, setLimit, delay: { value: raceDelayMs, set: setRaceDelayMs, accounts, setAccounts },
    methods: METHODS, method, setMethod: (m) => setMethod(m as StrategyName),
    methodBlocked: method === 'CONSTRAINT' && limit > 1 ? '“Built-in rule” only works when one screen is allowed.' : null,
    running, comparing, error, result: view, lanes, comparisonBatch: comparison[0]?.batchId, hasComparison: comparison.length > 0 || comparing, run, compareAll,
  };
}
