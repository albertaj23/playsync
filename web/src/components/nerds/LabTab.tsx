import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, type Aggregate, type ErrorBody, type ExperimentResponse, type LostUpdateAggregate,
  type LostUpdateResponse, type LostUpdateVariant, type StrategyName,
} from '../../lib/api';
import { uuid } from '../../lib/uuid';
import { Badge, Button, Card, Field, cx, inputCls } from '../ui';

const STRATEGIES: StrategyName[] = ['NAIVE', 'TXN_RR', 'SERIALIZABLE', 'PESSIMISTIC', 'OPTIMISTIC', 'CONSTRAINT'];
const LOST_UPDATE_VARIANTS: LostUpdateVariant[] = ['NAIVE_RMW', 'ATOMIC', 'LOCKED', 'CAS'];

function Checkboxes<T extends string>({ options, selected, onChange }: {
  options: T[]; selected: T[]; onChange: (v: T[]) => void;
}) {
  const toggle = (o: T) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o} className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm',
          selected.includes(o) ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-stone-200 text-stone-600')}>
          <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="accent-violet-600" />
          {o}
        </label>
      ))}
    </div>
  );
}

function BatchLink({ batchId }: { batchId: string }) {
  return (
    <Link to={`/nerds?tab=runs&batch=${batchId}`} className="text-xs font-medium text-violet-600 hover:underline">
      Open in Experiment runs →
    </Link>
  );
}

// -------------------------------------------------------------- Stream limit

function StreamLimitLab() {
  const [strategies, setStrategies] = useState<StrategyName[]>([...STRATEGIES]);
  const [isolation, setIsolation] = useState('');
  const [concurrency, setConcurrency] = useState(30);
  const [accounts, setAccounts] = useState(1);
  const [maxStreams, setMaxStreams] = useState(1);
  const [raceDelayMs, setRaceDelayMs] = useState(20);
  const [mode, setMode] = useState<'NORMAL' | 'TAKEOVER'>('NORMAL');
  const [trials, setTrials] = useState(10);
  const [running, setRunning] = useState<{ strategy: string; done: number; total: number } | null>(null);
  const [results, setResults] = useState<Aggregate[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResults([]);
    const targets = strategies.filter((s) => !(s === 'CONSTRAINT' && maxStreams > 1));
    const skippedConstraint = strategies.includes('CONSTRAINT') && maxStreams > 1;
    const batch = uuid();
    setBatchId(batch);
    const rows: Aggregate[] = [];
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i]!;
      setRunning({ strategy: s, done: i, total: targets.length });
      const r = await api.post<ExperimentResponse & ErrorBody>('/lab/experiments', {
        strategy: s, isolation: isolation || undefined, concurrency, accounts, maxStreams, raceDelayMs,
        mode, trials, batchId: batch,
      });
      if (!r.ok) {
        setError(r.status === 409
          ? 'Another experiment is running (maybe the CLI bench or the tests). Try again when it finishes.'
          : r.body.message ?? `Error ${r.status} (${s})`);
        break;
      }
      rows.push(r.body.aggregate);
      setResults([...rows]);
    }
    if (skippedConstraint) setError((e) => e ?? 'CONSTRAINT was skipped: it only supports max streams = 1.');
    setRunning(null);
  }

  return (
    <Card title="Stream limit experiment" subtitle="Runs multiple trials per strategy and saves every trial">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Field label="Strategies">
            <Checkboxes options={STRATEGIES} selected={strategies} onChange={setStrategies} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Isolation override" hint="only applied to TXN_RR">
              <select className={inputCls} value={isolation} onChange={(e) => setIsolation(e.target.value)}>
                <option value="">strategy default</option>
                {['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Mode">
              <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as 'NORMAL' | 'TAKEOVER')}>
                <option value="NORMAL">NORMAL</option>
                <option value="TAKEOVER">TAKEOVER</option>
              </select>
            </Field>
            <Field label={`Concurrency: ${concurrency}`}>
              <input type="range" min={2} max={100} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full accent-violet-600" />
            </Field>
            <Field label="Accounts">
              <select className={inputCls} value={accounts} onChange={(e) => setAccounts(Number(e.target.value))}>
                {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Max streams">
              <select className={inputCls} value={maxStreams} onChange={(e) => setMaxStreams(Number(e.target.value))}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Race delay">
              <select className={inputCls} value={raceDelayMs} onChange={(e) => setRaceDelayMs(Number(e.target.value))}>
                {[0, 5, 20, 50].map((n) => <option key={n} value={n}>{n} ms</option>)}
              </select>
            </Field>
            <Field label={`Trials: ${trials}`}>
              <input type="range" min={1} max={50} value={trials} onChange={(e) => setTrials(Number(e.target.value))} className="w-full accent-violet-600" />
            </Field>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button variant="primary" onClick={run} disabled={!!running || strategies.length === 0}>
            {running ? `Running ${running.strategy} (${running.done + 1}/${running.total})…` : 'Run'}
          </Button>
        </div>

        <div>
          {results.length === 0 ? (
            <div className="grid h-full min-h-40 place-items-center rounded-xl border border-dashed border-stone-300 text-sm text-stone-500">
              Results appear here as each strategy finishes.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-right font-mono text-[11px]">
                <thead className="text-left uppercase text-stone-500">
                  <tr>
                    {['strategy', 'iso', 'trials', 'viol tot', '% viol', 'retries', 'deadlocks', 'errors', 'p50', 'p95', 'rps'].map((h, i) => (
                      <th key={h} className={cx('px-2 py-1.5 font-medium', i < 2 ? 'text-left' : '')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {results.map((a) => (
                    <tr key={a.strategy}>
                      <td className="px-2 py-1.5 text-left font-medium text-stone-900">{a.strategy}</td>
                      <td className="px-2 py-1.5 text-left text-stone-500">{a.isolationUsed}</td>
                      <td className="px-2 py-1.5">{a.trials}</td>
                      <td className={cx('px-2 py-1.5', a.violationsTotal > 0 ? 'font-bold text-rose-600' : 'text-emerald-600')}>{a.violationsTotal}</td>
                      <td className="px-2 py-1.5">{Math.round((a.trialsWithViolations / a.trials) * 100)}%</td>
                      <td className="px-2 py-1.5 text-violet-600">{a.retriesMean}</td>
                      <td className="px-2 py-1.5 text-amber-600">{a.deadlocksMean}</td>
                      <td className="px-2 py-1.5 text-rose-500">{a.errorsTotal}</td>
                      <td className="px-2 py-1.5">{a.p50Median}</td>
                      <td className="px-2 py-1.5">{a.p95Median}</td>
                      <td className="px-2 py-1.5 text-sky-600">{a.throughputMean}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {batchId && <div className="mt-3"><BatchLink batchId={batchId} /></div>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------- Lost update

function LostUpdateLab() {
  const [variants, setVariants] = useState<LostUpdateVariant[]>([...LOST_UPDATE_VARIANTS]);
  const [increments, setIncrements] = useState(50);
  const [raceDelayMs, setRaceDelayMs] = useState(20);
  const [trials, setTrials] = useState(5);
  const [running, setRunning] = useState<{ variant: string; done: number; total: number } | null>(null);
  const [results, setResults] = useState<LostUpdateAggregate[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResults([]);
    const batch = uuid();
    setBatchId(batch);
    const rows: LostUpdateAggregate[] = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!;
      setRunning({ variant: v, done: i, total: variants.length });
      const r = await api.post<LostUpdateResponse & ErrorBody>('/lab/lost-update', {
        variant: v, increments, raceDelayMs, trials, batchId: batch,
      });
      if (!r.ok) {
        setError(r.status === 409
          ? 'Another experiment is running (maybe the CLI bench or the tests). Try again when it finishes.'
          : r.body.message ?? `Error ${r.status} (${v})`);
        break;
      }
      rows.push(r.body.aggregate);
      setResults([...rows]);
    }
    setRunning(null);
  }

  return (
    <Card title="Lost update experiment" subtitle="Concurrent increments of one row's counter">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Field label="Variants">
            <Checkboxes options={LOST_UPDATE_VARIANTS} selected={variants} onChange={setVariants} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={`Increments: ${increments}`}>
              <input type="range" min={2} max={100} value={increments} onChange={(e) => setIncrements(Number(e.target.value))} className="w-full accent-violet-600" />
            </Field>
            <Field label="Race delay">
              <select className={inputCls} value={raceDelayMs} onChange={(e) => setRaceDelayMs(Number(e.target.value))}>
                {[0, 5, 20, 50].map((n) => <option key={n} value={n}>{n} ms</option>)}
              </select>
            </Field>
            <Field label={`Trials: ${trials}`}>
              <input type="range" min={1} max={20} value={trials} onChange={(e) => setTrials(Number(e.target.value))} className="w-full accent-violet-600" />
            </Field>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button variant="primary" onClick={run} disabled={!!running || variants.length === 0}>
            {running ? `Running ${running.variant} (${running.done + 1}/${running.total})…` : 'Run'}
          </Button>
        </div>

        <div>
          {results.length === 0 ? (
            <div className="grid h-full min-h-40 place-items-center rounded-xl border border-dashed border-stone-300 text-sm text-stone-500">
              Results appear here as each variant finishes.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-right font-mono text-[11px]">
                <thead className="text-left uppercase text-stone-500">
                  <tr>
                    {['variant', 'iso', 'trials', 'final mean', 'lost tot', '% lossy', 'retries', 'errors', 'p50', 'p95'].map((h, i) => (
                      <th key={h} className={cx('px-2 py-1.5 font-medium', i < 2 ? 'text-left' : '')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {results.map((a) => (
                    <tr key={a.variant}>
                      <td className="px-2 py-1.5 text-left font-medium text-stone-900">{a.variant}</td>
                      <td className="px-2 py-1.5 text-left text-stone-500">{a.isolationUsed}</td>
                      <td className="px-2 py-1.5">{a.trials}</td>
                      <td className="px-2 py-1.5">{a.finalCountMean}</td>
                      <td className={cx('px-2 py-1.5', a.lostTotal > 0 ? 'font-bold text-rose-600' : 'text-emerald-600')}>{a.lostTotal}</td>
                      <td className="px-2 py-1.5">{Math.round((a.trialsWithLoss / a.trials) * 100)}%</td>
                      <td className="px-2 py-1.5 text-violet-600">{a.retriesMean}</td>
                      <td className="px-2 py-1.5 text-rose-500">{a.errorsTotal}</td>
                      <td className="px-2 py-1.5">{a.p50Median}</td>
                      <td className="px-2 py-1.5">{a.p95Median}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {batchId && <div className="mt-3"><BatchLink batchId={batchId} /></div>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------- page

export function LabTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600">
        Full control over the Concurrency Lab: pick strategies, parameters and trial counts directly. Only one
        experiment (this tab, the CLI bench, or the test suite) can run at a time; a busy lab shows{' '}
        <Badge tone="amber">409 BUSY</Badge> below its Run button.
      </p>
      <StreamLimitLab />
      <LostUpdateLab />
    </div>
  );
}
