import { useState } from 'react';
import { api, type ErrorBody, type IndexExperimentResult, type IndexVariant } from '../../lib/api';
import { Badge, Button, Card, Stat } from '../ui';

const TITLE: Record<IndexVariant['variant'], { title: string; sub: string }> = {
  WITH_INDEX: { title: 'Both indexes', sub: 'ix_session_account_status_lease (account_id, status, lease_expires_at) present' },
  WITHOUT_COMPOSITE: { title: 'Without the composite index', sub: 'only ix_session_status_lease (status, lease_expires_at) left' },
  WITHOUT_ANY_INDEX: { title: 'No usable index', sub: 'both secondary indexes dropped: full scan of the clustered index' },
};

function Variant({ v }: { v: IndexVariant }) {
  const bad = v.otherAccountBlocked;
  return (
    <Card title={TITLE[v.variant].title} subtitle={TITLE[v.variant].sub}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="locks held by ONE account's UPDATE" value={v.locksHeld} tone={v.locksHeld > 100 ? 'red' : 'green'} hint={`${v.recordLocks} record + ${v.tableLocks} table`} />
          <Stat label="another account's UPDATE" value={bad ? 'BLOCKED' : 'ran freely'} tone={bad ? 'red' : 'green'} hint={`${v.otherAccountMs} ms (1 s timeout)`} />
        </div>
        <p className="font-mono text-xs text-stone-600">
          EXPLAIN → key <Badge>{v.explain.key ?? 'none'}</Badge> type <Badge tone={v.explain.type === 'ALL' ? 'red' : 'green'}>{v.explain.type}</Badge> · count query {v.countMs} ms
        </p>
        <pre className="max-h-48 overflow-auto rounded-lg bg-fg/[0.06] p-3 font-mono text-[11px] leading-relaxed text-stone-800">{v.explainAnalyze}</pre>
      </div>
    </Card>
  );
}

/** Phase 6 index experiment: the composite index changes the LOCK footprint, not only the speed. */
export function IndexTab() {
  const [result, setResult] = useState<IndexExperimentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    const r = await api.post<IndexExperimentResult & ErrorBody>('/lab/index-experiment');
    setBusy(false);
    if (r.ok) setResult(r.body); else setError(r.status === 409 ? 'Another experiment is running.' : (r.body.message ?? `Error ${r.status}`));
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-stone-600">
        Loads about 20,000 historical sessions, then, for each index setup, runs the CONSTRAINT strategy's expire <code>UPDATE</code> for one account inside a REPEATABLE READ
        transaction and counts the InnoDB locks it holds. A second connection then tries the same <code>UPDATE</code> for a <em>different</em> account.
        Without the composite index InnoDB locks every index record it scans, so unrelated accounts block each other. Everything is cleaned up and both indexes are restored afterwards.
      </p>
      <Button variant="primary" onClick={run} disabled={busy}>{busy ? 'Running (about 5 s)…' : 'Run the index experiment'}</Button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {result && (
        <>
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 font-mono text-sm text-violet-300">{result.finding}</div>
          <div className="grid gap-4 lg:grid-cols-3">{result.variants.map((v) => <Variant key={v.variant} v={v} />)}</div>
          <p className="font-mono text-xs text-stone-500">{result.historyRows} rows loaded across {result.accountsTouched} lab accounts (tagged and deleted afterwards).</p>
        </>
      )}
    </div>
  );
}
