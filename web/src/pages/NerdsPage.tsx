import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ChecksResponse, type ErrorBody, type EventRow } from '../lib/api';
import { useAccountState } from '../lib/socket';
import { useTrace } from '../lib/trace';
import { Badge, Dot, cx } from '../components/ui';
import { AuditTab } from '../components/nerds/AuditTab';
import { ChecksTab, type CheckRun } from '../components/nerds/ChecksTab';
import { DatabaseTab } from '../components/nerds/DatabaseTab';
import { LiveStateTab } from '../components/nerds/LiveStateTab';
import { StressTab } from '../components/nerds/StressTab';
import { TraceTab } from '../components/nerds/TraceTab';

const TABS = [
  { id: 'checks', label: 'Checks' },
  { id: 'trace', label: 'Action trace' },
  { id: 'live', label: 'Live state' },
  { id: 'audit', label: 'Audit log' },
  { id: 'stress', label: 'Stress data' },
  { id: 'database', label: 'Database' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function NerdsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'checks') as TabId;
  const username = params.get('account') ?? 'brij';

  const [accountId, setAccountId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checks, setChecks] = useState<ChecksResponse | null>(null);
  const [history, setHistory] = useState<CheckRun[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const trace = useTrace();
  const latestAction = useRef<string | undefined>(undefined);
  latestAction.current = trace[0]?.summary;

  useEffect(() => {
    api.get<{ accountId: number } & ErrorBody>(`/accounts/lookup?username=${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? setAccountId(r.body.accountId) : setLoadError(r.body.message ?? 'account not found')))
      .catch((e: Error) => setLoadError(e.message));
  }, [username]);

  // Observer connection: this page watches the account without being a device.
  const { snapshot, connected } = useAccountState({ accountId });

  // Re-verify after every change: each push (and each traced action) triggers the checks.
  const refresh = useCallback(async () => {
    if (accountId === null) return;
    const [c, e] = await Promise.all([
      api.get<ChecksResponse>(`/accounts/${accountId}/checks`),
      api.get<EventRow[]>(`/accounts/${accountId}/events?limit=100`),
    ]);
    if (c.ok) {
      setChecks(c.body);
      setHistory((h) => [{
        at: Date.now(), allPassed: c.body.allPassed,
        failed: c.body.checks.filter((x) => !x.passed).map((x) => x.title),
        after: latestAction.current,
      }, ...h].slice(0, 30));
    }
    if (e.ok) setEvents(e.body);
  }, [accountId]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { void refresh(); }, 250);
    return () => { if (pending.current) clearTimeout(pending.current); };
  }, [refresh, snapshot?.stateVersion, snapshot?.receivedAt, trace[0]?.id]);

  const setTab = (id: TabId) => setParams((p) => { p.set('tab', id); return p; }, { replace: true });

  if (loadError) return <p className="text-rose-600">Couldn&apos;t load account “{username}”: {loadError}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-stone-900">stats for nerds</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            What the friendly pages hide: every request they sent, what the server answered, the live database state,
            and checks the server runs against MySQL after every change.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-stone-500">
          <Badge>account {username}{accountId ? ` #${accountId}` : ''}</Badge>
          <span className="inline-flex items-center gap-1.5"><Dot tone={connected ? 'green' : 'red'} />{connected ? 'live' : 'offline'}</span>
          {checks && <Badge tone={checks.allPassed ? 'green' : 'red'}>{checks.allPassed ? 'all checks pass' : 'check failing'}</Badge>}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx('-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 font-mono text-sm transition-colors',
              tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-stone-500 hover:text-stone-800')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'checks' && <ChecksTab checks={checks} history={history} snapshot={snapshot} onRunNow={refresh} />}
      {tab === 'trace' && <TraceTab trace={trace} snapshot={snapshot} />}
      {tab === 'live' && <LiveStateTab snapshot={snapshot} connected={connected} />}
      {tab === 'audit' && <AuditTab events={events} />}
      {tab === 'stress' && <StressTab trace={trace} />}
      {tab === 'database' && <DatabaseTab />}
    </div>
  );
}
