import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api, type ErrorBody, type InvariantResult, type LockSnapshot, type StepperScenario,
  type StepperStateView, type StepperUpdate, type StepResultView, type TxnLabel, type TxnView,
} from '../../lib/api';
import { useStepperUpdates } from '../../lib/socket';
import { Badge, Button, Card, Dot, cx, inputCls } from '../ui';

const LOCK_MODE_LEGEND: [string, string][] = [
  ['IX', 'table-level intention lock (multi-granularity locking)'],
  ['X,REC_NOT_GAP', 'record lock (locks exactly this row)'],
  ['S / X', 'shared / exclusive next-key lock (row + the gap before it)'],
  ['X,GAP', 'gap lock only (no row)'],
  ['X,INSERT_INTENTION', 'a pending INSERT waiting to acquire the gap'],
];

function statusTone(status: string) {
  switch (status) {
    case 'DONE': return 'green' as const;
    case 'ERROR': return 'red' as const;
    case 'WAITING': return 'amber' as const;
    case 'KILLED': return 'stone' as const;
    default: return 'stone' as const;
  }
}

function mergeUpdate(state: StepperStateView, update: StepperUpdate): StepperStateView {
  const txn = state.txns[update.txn];
  if (update.killed) {
    return { ...state, txns: { ...state.txns, [update.txn]: { ...txn, killed: true, busy: false } } };
  }
  if (!update.result) return state;
  const steps = txn.steps.map((s) => (s.index === update.result!.index ? update.result! : s));
  return { ...state, txns: { ...state.txns, [update.txn]: { ...txn, steps, busy: false } } };
}

function TxnColumn({ txn, onStep, onKill, busy }: {
  txn: TxnView; onStep: () => void; onKill: () => void; busy: boolean;
}) {
  const finished = txn.cursor >= txn.steps.length;
  const canStep = !txn.killed && !txn.busy && !finished && !busy;
  return (
    <Card
      title={<span className="font-mono">{txn.label}</span>}
      subtitle={txn.killed ? 'killed' : txn.isolation ? `${txn.isolation} · conn ${txn.connId ?? '—'}` : 'not started'}
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={onStep} disabled={!canStep}>
            {txn.busy ? 'Waiting…' : 'Step'}
          </Button>
          <Button size="sm" variant="danger" onClick={onKill} disabled={txn.killed || !txn.connId || busy}>
            Kill
          </Button>
        </div>
      }
      padded={false}
    >
      <ol className="divide-y divide-stone-100">
        {txn.steps.map((s, i) => (
          <li key={i} className={cx('px-5 py-3', i === txn.cursor && !finished && 'bg-violet-500/10')}>
            <div className="flex items-start justify-between gap-3">
              <code className="min-w-0 flex-1 break-words font-mono text-xs text-stone-800">
                {s.resolvedSql ?? s.display}
              </code>
              <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </div>
            {s.status === 'DONE' && (s.rows !== undefined || s.affectedRows !== undefined) && (
              <div className="mt-1 font-mono text-[11px] text-emerald-400">
                {s.rows !== undefined ? JSON.stringify(s.rows) : `${s.affectedRows} row(s) affected`}
              </div>
            )}
            {s.status === 'ERROR' && (
              <div className="mt-1 font-mono text-[11px] text-rose-400">
                errno {s.errno}: {s.errorMessage}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function WaitForGraph({ waits, cycle }: { waits: LockSnapshot['waits']; cycle: boolean }) {
  const t1WaitsT2 = waits.some((w) => w.waitingLabel === 'T1' && w.blockingLabel === 'T2');
  const t2WaitsT1 = waits.some((w) => w.waitingLabel === 'T2' && w.blockingLabel === 'T1');
  const stroke = cycle ? 'var(--c-red-400)' : 'var(--s500)';
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 260 120" className="w-full max-w-xs">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={stroke} />
          </marker>
        </defs>
        <circle cx="60" cy="60" r="30" fill={cycle ? 'rgba(244,63,94,0.18)' : 'rgba(139,92,246,0.16)'} stroke={cycle ? 'var(--c-red-400)' : 'var(--c-brand-400)'} strokeWidth="2" />
        <text x="60" y="65" textAnchor="middle" className="fill-stone-900 text-sm font-semibold">T1</text>
        <circle cx="200" cy="60" r="30" fill={cycle ? 'rgba(244,63,94,0.18)' : 'rgba(139,92,246,0.16)'} stroke={cycle ? 'var(--c-red-400)' : 'var(--c-brand-400)'} strokeWidth="2" />
        <text x="200" y="65" textAnchor="middle" className="fill-stone-900 text-sm font-semibold">T2</text>
        {t1WaitsT2 && <path d="M 92 50 Q 130 20 168 50" fill="none" stroke={stroke} strokeWidth="2" markerEnd="url(#arrow)" />}
        {t2WaitsT1 && <path d="M 168 70 Q 130 100 92 70" fill="none" stroke={stroke} strokeWidth="2" markerEnd="url(#arrow)" />}
      </svg>
      <p className={cx('text-xs', cycle ? 'font-semibold text-rose-400' : 'text-stone-500')}>
        {cycle ? 'Wait-for cycle: deadlock' : waits.length > 0 ? 'One side is waiting' : 'No one is waiting'}
      </p>
    </div>
  );
}

export function StepperTab() {
  const [urlParams] = useSearchParams();
  const wanted = urlParams.get('scenario');
  const [scenarios, setScenarios] = useState<StepperScenario[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [state, setState] = useState<StepperStateView | null>(null);
  const [locks, setLocks] = useState<LockSnapshot | null>(null);
  const [invariant, setInvariant] = useState<InvariantResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeadlockText, setShowDeadlockText] = useState(false);

  useEffect(() => {
    api.get<StepperScenario[]>('/lab/stepper/scenarios').then((r) => {
      if (r.ok) { setScenarios(r.body); setSelectedId((id) => id || (wanted && r.body.some((x) => x.id === wanted) ? wanted : r.body[0]?.id) || ''); }
    });
  }, []);

  const { connected } = useStepperUpdates((update) => setState((s) => (s ? mergeUpdate(s, update) : s)));

  // Poll the lock table and the invariant every 500ms while a scenario is loaded.
  const pollRef = useRef(false);
  useEffect(() => {
    if (!state) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || pollRef.current) return;
      pollRef.current = true;
      const [locksRes, invRes] = await Promise.all([
        api.get<LockSnapshot>('/lab/locks'),
        api.get<InvariantResult>('/lab/stepper/invariant'),
      ]);
      if (!stopped) {
        if (locksRes.ok) setLocks(locksRes.body);
        if (invRes.ok) setInvariant(invRes.body);
      }
      pollRef.current = false;
    };
    void tick();
    const id = setInterval(tick, 500);
    return () => { stopped = true; clearInterval(id); };
  }, [state?.scenarioId]);

  async function loadScenario() {
    setError(null);
    setBusy(true);
    const r = await api.post<StepperStateView & ErrorBody>('/lab/stepper/load', { scenarioId: selectedId });
    setBusy(false);
    if (r.ok) setState(r.body); else setError(r.body.message ?? `Error ${r.status}`);
  }

  async function reset() {
    setError(null);
    setBusy(true);
    const r = await api.post<StepperStateView & ErrorBody>('/lab/stepper/reset');
    setBusy(false);
    if (r.ok) setState(r.body); else setError(r.body.message ?? `Error ${r.status}`);
  }

  async function stepTxn(txn: TxnLabel) {
    setError(null);
    const r = await api.post<StepResultView & ErrorBody>('/lab/stepper/step', { txn });
    if (r.ok) {
      setState((s) => (s ? { ...s, txns: { ...s.txns, [txn]: {
        ...s.txns[txn], busy: r.body.status === 'WAITING', cursor: s.txns[txn].cursor,
        steps: s.txns[txn].steps.map((step) => (step.index === r.body.index ? r.body : step)),
      } } } : s));
    } else {
      setError(r.body.message ?? `Error ${r.status}`);
    }
  }

  async function killTxn(txn: TxnLabel) {
    setError(null);
    setBusy(true);
    const r = await api.post<StepperStateView & ErrorBody>('/lab/stepper/kill', { txn });
    setBusy(false);
    if (r.ok) setState(r.body); else setError(r.body.message ?? `Error ${r.status}`);
  }

  const scenario = scenarios.find((s) => s.id === (state?.scenarioId ?? selectedId));
  const deadlock = state && (
    state.txns.T1.steps.find((s) => s.errno === 1213) ??
    state.txns.T2.steps.find((s) => s.errno === 1213)
  );
  const deadlockVictim = state?.txns.T1.steps.some((s) => s.errno === 1213) ? 'T1' : 'T2';

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600">
        Two real MySQL transactions, one SQL statement at a time. Watch the live InnoDB lock table, who
        waits for whom, and what happens on a deadlock or a KILL. <Dot tone={connected ? 'green' : 'red'} />{' '}
        <span className="align-middle text-xs">{connected ? 'live' : 'reconnecting…'}</span>
      </p>

      <Card title="Scenario">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <select className={inputCls} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <Button variant="primary" onClick={loadScenario} disabled={busy || !selectedId}>Load scenario</Button>
          <Button onClick={reset} disabled={busy || !state}>Reset</Button>
        </div>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        {scenario && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {scenario.syllabusRefs.map((tag) => <Badge key={tag} tone="violet">{tag}</Badge>)}
            </div>
            <p className="text-sm text-stone-800"><strong>Expected:</strong> {scenario.expected}</p>
            <p className="text-sm text-stone-600">{scenario.explanation}</p>
          </div>
        )}
      </Card>

      {state && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TxnColumn txn={state.txns.T1} onStep={() => stepTxn('T1')} onKill={() => killTxn('T1')} busy={busy} />
            <TxnColumn txn={state.txns.T2} onStep={() => stepTxn('T2')} onKill={() => killTxn('T2')} busy={busy} />
          </div>

          {deadlock && (
            <Card title="Deadlock detected" className="border-rose-500/30 bg-rose-500/10">
              <p className="text-sm text-rose-400">
                InnoDB killed <strong>{deadlockVictim}</strong> (errno 1213) to break the wait-for cycle.
              </p>
              <button onClick={() => setShowDeadlockText((v) => !v)} className="mt-2 text-xs font-medium text-rose-400 underline-offset-2 hover:underline">
                {showDeadlockText ? 'Hide' : 'Show'} SHOW ENGINE INNODB STATUS excerpt
              </button>
              {showDeadlockText && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-fg/[0.06] p-3 font-mono text-[11px] text-stone-800">
                  {deadlock.deadlockText}
                </pre>
              )}
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Wait-for graph">
              <WaitForGraph waits={locks?.waits ?? []} cycle={locks?.cycle ?? false} />
            </Card>
            <Card title="Invariant" subtitle="checked on the scenario's accounts">
              {invariant ? (
                <div className="flex items-center gap-3">
                  <Badge tone={invariant.violations === 0 ? 'green' : 'red'}>
                    {invariant.violations === 0 ? 'holds' : `${invariant.violations} violation(s)`}
                  </Badge>
                  {invariant.breaches.map((b) => (
                    <span key={b.accountId} className="font-mono text-xs text-stone-600">
                      account {b.accountId}: {b.active}/{b.maxStreams} active
                    </span>
                  ))}
                </div>
              ) : <p className="text-sm text-stone-500">Checking…</p>}
            </Card>
          </div>

          <Card title="Lock table" subtitle="performance_schema.data_locks, polled every 500ms" padded={false}>
            <div className="overflow-auto">
              <table className="w-full min-w-[600px] text-left font-mono text-xs">
                <thead className="bg-stone-50 text-[11px] uppercase text-stone-500">
                  <tr>{['txn', 'table', 'index', 'type', 'mode', 'status', 'data'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {(locks?.locks ?? []).map((l, i) => (
                    <tr key={i}>
                      <td className="px-4 py-1.5"><Badge tone={l.label === 'other' ? 'stone' : 'violet'}>{l.label}</Badge></td>
                      <td className="px-4 py-1.5">{l.table}</td>
                      <td className="px-4 py-1.5">{l.index ?? '—'}</td>
                      <td className="px-4 py-1.5">{l.type}</td>
                      <td className="px-4 py-1.5">{l.mode}</td>
                      <td className="px-4 py-1.5"><Badge tone={l.status === 'WAITING' ? 'amber' : 'green'}>{l.status}</Badge></td>
                      <td className="px-4 py-1.5 text-stone-500">{l.data ?? '—'}</td>
                    </tr>
                  ))}
                  {(locks?.locks ?? []).length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-4 text-center text-stone-400">No locks held right now.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-stone-100 px-5 py-4">
              <div className="mb-1.5 text-xs font-medium text-stone-500">Lock modes</div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {LOCK_MODE_LEGEND.map(([mode, meaning]) => (
                  <div key={mode} className="flex gap-2 text-xs">
                    <dt className="shrink-0 font-mono font-medium text-stone-700">{mode}</dt>
                    <dd className="text-stone-500">{meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-stone-500">FK checks take <code className="font-mono">S,REC_NOT_GAP</code> locks on parent rows (device, song).</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
