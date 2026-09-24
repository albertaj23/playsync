import { useEffect, useState } from 'react';
import { api, type ErrorBody, type StrategyName } from '../../lib/api';
import { leaseRemaining, type LiveSnapshot } from '../../lib/socket';
import { Badge, Card, Dot, Stat, inputCls } from '../ui';
import { fmtSec } from '../../lib/format';

const STRATEGIES: StrategyName[] = ['PESSIMISTIC', 'OPTIMISTIC', 'SERIALIZABLE', 'CONSTRAINT', 'TXN_RR', 'NAIVE'];

export function LiveStateTab({ snapshot, connected }: { snapshot: LiveSnapshot | null; connected: boolean }) {
  const [, tick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  async function switchStrategy(strategy: string) {
    const r = await api.put<ErrorBody>('/admin/strategy', { strategy });
    setMsg(r.ok ? `Live strategy is now ${strategy}.` : r.body?.message ?? `Error ${r.status}`);
  }

  if (!snapshot) return <p className="text-sm text-stone-500">Waiting for the first snapshot…</p>;
  const activeCount = snapshot.sessions.filter((s) => s.status === 'PLAYING').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="state_version" value={snapshot.stateVersion} hint="bumped on every change" />
        <Stat label="active / max_streams" value={`${activeCount} / ${snapshot.maxStreams}`} tone={activeCount <= snapshot.maxStreams ? 'green' : 'red'} />
        <Stat label="conflict_policy" value={snapshot.conflictPolicy} />
        <Stat label="socket" value={connected ? 'connected' : 'down'} tone={connected ? 'green' : 'red'} hint="observer, no device" />
        <div className="rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3">
          <div className="text-xs font-medium text-stone-500">live strategy</div>
          <select className={`${inputCls} mt-1 font-mono text-xs`} value={snapshot.strategy} onChange={(e) => switchStrategy(e.target.value)}>
            {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {msg && <p className="text-sm text-stone-600">{msg}</p>}

      <Card title="playback_session" subtitle="PLAYING with an unexpired lease, plus PAUSED" padded={false}>
        {snapshot.sessions.length === 0 ? (
          <p className="px-5 py-5 text-sm text-stone-500">No open sessions.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left font-mono text-xs min-w-[600px]">
              <thead className="bg-stone-50 text-[11px] uppercase text-stone-500">
                <tr>{['session', 'device', 'song', 'status', 'position', 'lease left'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {snapshot.sessions.map((s) => {
                  const left = leaseRemaining(snapshot, s.leaseRemainingMs);
                  return (
                    <tr key={s.sessionId}>
                      <td className="px-5 py-2">#{s.sessionId}</td>
                      <td className="px-5 py-2 font-sans">{s.deviceName}</td>
                      <td className="px-5 py-2 font-sans">{s.songTitle}</td>
                      <td className="px-5 py-2"><Badge tone={s.status === 'PLAYING' ? 'green' : 'amber'}>{s.status}</Badge></td>
                      <td className="px-5 py-2">{(s.positionMs / 1000).toFixed(1)}s</td>
                      <td className="px-5 py-2">{s.status === 'PLAYING' ? fmtSec(left) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="device" padded={false}>
        {snapshot.devices.length === 0 ? (
          <p className="px-5 py-5 text-sm text-stone-500">No devices.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left font-mono text-xs min-w-[400px]">
              <thead className="bg-stone-50 text-[11px] uppercase text-stone-500">
                <tr>{['name', 'type', 'online'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {snapshot.devices.map((d) => (
                  <tr key={d.deviceId}>
                    <td className="px-5 py-2 font-sans">{d.deviceName}</td>
                    <td className="px-5 py-2">{d.deviceType}</td>
                    <td className="px-5 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Dot tone={d.online ? 'green' : 'stone'} />
                        {d.online ? 'Online' : 'Offline'}
                      </span>
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