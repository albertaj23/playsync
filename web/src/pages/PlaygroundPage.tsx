import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type AppConfig, type ErrorBody, type EventRow, type Policy, type Snapshot, type Song, type StrategyName } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { DevicePanel } from '../components/DevicePanel';
import { Badge, Button, Card, Code, cx, inputCls, type Tone } from '../components/ui';

const STRATEGIES: StrategyName[] = ['PESSIMISTIC', 'OPTIMISTIC', 'SERIALIZABLE', 'CONSTRAINT', 'TXN_RR', 'NAIVE'];
const POLICIES: { value: Policy; hint: string }[] = [
  { value: 'ASK', hint: 'Show a “Take over?” prompt' },
  { value: 'TAKEOVER', hint: 'Newest device always wins' },
  { value: 'REJECT', hint: 'First device keeps the stream' },
];

const EVENT_TONE: Record<string, Tone> = {
  CLAIM_GRANTED: 'green', CLAIM_REJECTED: 'amber', PREEMPTED: 'red', PAUSED: 'sky',
  RELEASED: 'zinc', EXPIRED: 'red', HEARTBEAT_REJECTED: 'red',
};

function eventDetail(e: EventRow): string {
  const d = e.detail ?? {};
  switch (e.type) {
    case 'CLAIM_GRANTED': {
      const pre = (d.preempted as { sessionId: number }[] | undefined) ?? [];
      return pre.length ? `${d.mode} · preempted #${pre.map((p) => p.sessionId).join(', #')}` : String(d.mode ?? '');
    }
    case 'CLAIM_REJECTED': return `held by ${((d.holders as { deviceName: string }[] | undefined) ?? []).map((h) => h.deviceName).join(', ')}`;
    case 'PREEMPTED': return `by session #${d.bySessionId}`;
    case 'HEARTBEAT_REJECTED': return `reason ${d.reason}`;
    case 'PAUSED': case 'RELEASED': return d.positionMs !== undefined ? `at ${Math.round(Number(d.positionMs) / 1000)}s` : String(d.by ?? '');
    default: return '';
  }
}

export default function PlaygroundPage() {
  const [params] = useSearchParams();
  const username = params.get('account') ?? 'brij';
  // ?device=iPhone shows only that device's panel, for opening the page on a real phone.
  const onlyDevice = params.get('device');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [adminMsg, setAdminMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ accountId: number } & ErrorBody>(`/accounts/lookup?username=${encodeURIComponent(username)}`).then((r) => {
      if (r.ok) setAccountId(r.body.accountId); else setLoadError(r.body.message ?? 'account not found');
    }).catch((e: Error) => setLoadError(e.message));
    api.get<Song[]>('/songs').then((r) => r.ok && setSongs(r.body));
    api.get<AppConfig>('/config').then((r) => r.ok && setCfg(r.body));
  }, [username]);

  const refresh = useCallback(async () => {
    if (accountId === null) return;
    const [s, e] = await Promise.all([
      api.get<Snapshot>(`/accounts/${accountId}/state`),
      api.get<EventRow[]>(`/accounts/${accountId}/events?limit=40`),
    ]);
    // Keep only the newest state (the same rule the Phase 3 versioned store applies to pushes).
    if (s.ok) setSnap((prev) => (prev && prev.stateVersion > s.body.stateVersion ? prev : s.body));
    if (e.ok) setEvents(e.body);
  }, [accountId]);

  usePoll(refresh, 1000, [refresh]);

  async function admin(path: string, method: 'PUT' | 'POST', body: unknown, ok: string) {
    const r = method === 'PUT' ? await api.put<ErrorBody>(path, body) : await api.post<ErrorBody>(path, body);
    setAdminMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.body.message ?? `Error ${r.status}` });
    await refresh();
  }

  if (loadError) return <Card title="Couldn't load the playground"><p className="text-sm text-rose-300">{loadError}. Is the server running?</p></Card>;
  if (!snap || !cfg || songs.length === 0) return <div className="text-sm text-zinc-500">Loading playground…</div>;

  const active = snap.sessions.filter((s) => s.status === 'PLAYING');
  const paused = snap.sessions.filter((s) => s.status === 'PAUSED');
  const ok = active.length <= snap.maxStreams;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Playground</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Account <Code>{username}</Code> with four simulated devices. Each panel is an independent client with its own session,
            heartbeats and sleep switch.
          </p>
        </div>
        <Badge tone="zinc">state polled every 1s · socket push arrives in Phase 3</Badge>
      </div>

      {/* Admin + invariant */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Account controls" subtitle="Changes take effect on the next claim">
          <div className="grid gap-5 md:grid-cols-[1.2fr_0.6fr_1.4fr]">
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-400">Concurrency strategy (live)</div>
              <select
                className={inputCls}
                value={snap.strategy}
                onChange={(e) => admin('/admin/strategy', 'PUT', { strategy: e.target.value }, `Live strategy → ${e.target.value}`)}
              >
                {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-400">Max streams</div>
              <select
                className={inputCls}
                value={snap.maxStreams}
                onChange={(e) => admin(`/accounts/${snap.accountId}/settings`, 'PUT',
                  { maxStreams: Number(e.target.value), conflictPolicy: snap.conflictPolicy }, `Max streams → ${e.target.value}`)}
              >
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-400">Conflict policy</div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-950 p-1 ring-1 ring-zinc-800">
                {POLICIES.map((p) => (
                  <button
                    key={p.value}
                    title={p.hint}
                    onClick={() => admin(`/accounts/${snap.accountId}/settings`, 'PUT',
                      { maxStreams: snap.maxStreams, conflictPolicy: p.value }, `Policy → ${p.value}`)}
                    className={cx('rounded-md py-1 text-xs font-medium transition-colors',
                      snap.conflictPolicy === p.value ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200')}
                  >
                    {p.value}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">{POLICIES.find((p) => p.value === snap.conflictPolicy)?.hint}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800/80 pt-3">
            <div className={cx('text-xs', adminMsg ? (adminMsg.ok ? 'text-emerald-300' : 'text-rose-300') : 'text-zinc-500')}>
              {adminMsg?.text ?? 'Tip: NAIVE and TXN_RR are unsafe on purpose. Try them in the Race lab.'}
            </div>
            <Button variant="ghost" onClick={() => admin(`/accounts/${snap.accountId}/end-all`, 'POST', {}, 'All sessions ended')}>
              End all sessions
            </Button>
          </div>
        </Card>

        <Card title="Invariant" subtitle="active PLAYING sessions ≤ max_streams">
          <div className="flex items-center gap-4">
            <div className={cx('text-4xl font-semibold tabular-nums', ok ? 'text-emerald-300' : 'text-rose-300')}>
              {active.length}<span className="text-zinc-600"> / {snap.maxStreams}</span>
            </div>
            <Badge tone={ok ? 'green' : 'red'}>{ok ? 'holds' : 'VIOLATED'}</Badge>
          </div>
          <div className="mt-3 flex gap-1.5">
            {Array.from({ length: Math.max(snap.maxStreams, active.length) }, (_, i) => (
              <div key={i} className={cx('h-2 flex-1 rounded-full',
                i < active.length ? (i < snap.maxStreams ? 'bg-emerald-400' : 'bg-rose-400') : 'bg-zinc-800')} />
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-zinc-500">state_version</dt><dd className="text-right font-mono text-zinc-200">{snap.stateVersion}</dd>
            <dt className="text-zinc-500">paused (no slot)</dt><dd className="text-right font-mono text-zinc-200">{paused.length}</dd>
            <dt className="text-zinc-500">lease / heartbeat</dt><dd className="text-right font-mono text-zinc-200">{cfg.leaseMs / 1000}s / {cfg.heartbeatMs / 1000}s</dd>
          </dl>
        </Card>
      </div>

      {/* Devices */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {snap.devices.filter((d) => !onlyDevice || d.deviceName.toLowerCase() === onlyDevice.toLowerCase()).map((d) => (
          <DevicePanel key={d.deviceId} device={d} snapshot={snap} songs={songs} cfg={cfg} onChanged={refresh} />
        ))}
      </div>

      {/* Try this */}
      <Card title="Things to try">
        <ol className="grid gap-3 text-sm text-zinc-400 md:grid-cols-2 xl:grid-cols-4">
          <li><strong className="text-zinc-200">Handoff.</strong> Play on MacBook, then Play on iPhone. With ASK you get a takeover prompt; confirm it and the MacBook learns on its next heartbeat.</li>
          <li><strong className="text-zinc-200">Zombie device.</strong> Play on MacBook, press Sleep, take over from iPad, then Wake the MacBook. Its stale heartbeat gets <Code>410 PREEMPTED</Code>.</li>
          <li><strong className="text-zinc-200">Lease expiry.</strong> Play, press Sleep and wait {cfg.leaseMs / 1000}s. The server stops listing the session; Wake gets <Code>410 EXPIRED</Code>, and the lease is never revived.</li>
          <li><strong className="text-zinc-200">Idempotency.</strong> Use “Send duplicate claim”: two concurrent requests with one id yield one session. Check the audit log.</li>
        </ol>
      </Card>

      {/* Event log */}
      <Card title="Audit log" subtitle="playback_event, newest first" action={<Badge>{events.length} shown</Badge>}>
        {events.length === 0 ? (
          <div className="text-sm text-zinc-500">No events yet. Press Play on a device.</div>
        ) : (
          <div className="-mx-5 -my-5 max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-2 font-medium" title="DB clock, NOW(3) in UTC">time (db, utc)</th>
                  <th className="px-2 py-2 font-medium">event</th>
                  <th className="px-2 py-2 font-medium">device</th>
                  <th className="px-2 py-2 font-medium">session</th>
                  <th className="px-2 py-2 font-medium">version</th>
                  <th className="px-5 py-2 font-medium">detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {events.map((e) => (
                  <tr key={e.eventId} className="hover:bg-zinc-800/30">
                    <td className="px-5 py-2 font-mono text-zinc-500">{e.at}</td>
                    <td className="px-2 py-2"><Badge tone={EVENT_TONE[e.type] ?? 'zinc'}>{e.type}</Badge></td>
                    <td className="px-2 py-2 text-zinc-300">{e.deviceName ?? e.deviceId}</td>
                    <td className="px-2 py-2 font-mono text-zinc-400">{e.sessionId ? `#${e.sessionId}` : '—'}</td>
                    <td className="px-2 py-2 font-mono text-zinc-400">v{e.stateVersion}</td>
                    <td className="px-5 py-2 text-zinc-400">
                      {eventDetail(e)}
                      {e.clientRequestId && <span className="ml-2 font-mono text-[10px] text-zinc-600" title={e.clientRequestId}>req {e.clientRequestId.slice(0, 8)}</span>}
                    </td>
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
