import { Fragment, useState } from 'react';
import type { LiveSnapshot } from '../../lib/socket';
import { clearTrace, type TraceEntry } from '../../lib/trace';
import { Badge, Button, Card, cx } from '../ui';

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false }) + '.' + String(ms % 1000).padStart(3, '0');

function statusTone(e: TraceEntry) {
  if (e.kind === 'push') return 'violet' as const;
  if (!e.status) return 'stone' as const;
  if (e.status < 300) return 'green' as const;
  if (e.status === 409) return 'amber' as const;
  return 'red' as const;
}

export function TraceTab({ trace, snapshot }: { trace: TraceEntry[]; snapshot: LiveSnapshot | null }) {
  const [hideBeats, setHideBeats] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const name = (id?: number) => (id === undefined ? '—' : snapshot?.devices.find((d) => d.deviceId === id)?.deviceName ?? `#${id}`);
  const rows = trace.filter((e) => !(hideBeats && e.path === '/playback/heartbeat' && e.status === 200));

  return (
    <Card
      title="Action trace"
      subtitle="Every state-changing request this browser sent (in any tab), and every session_lost push"
      padded={false}
      action={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-stone-600">
            <input type="checkbox" checked={hideBeats} onChange={(e) => setHideBeats(e.target.checked)} className="accent-violet-600" />
            hide successful heartbeats
          </label>
          <Button size="sm" variant="ghost" onClick={clearTrace}>Clear</Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-stone-500">Nothing yet. Use the stress test or the devices page, and the requests appear here.</p>
      ) : (
        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-stone-50 font-mono text-[11px] uppercase text-stone-500">
              <tr>
                <th className="px-5 py-2 font-medium">time</th>
                <th className="px-2 py-2 font-medium">status</th>
                <th className="px-2 py-2 font-medium">device</th>
                <th className="px-2 py-2 font-medium">what happened</th>
                <th className="px-5 py-2 text-right font-medium">ms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((e) => (
                <Fragment key={e.id}>
                  <tr onClick={() => setOpen(open === e.id ? null : e.id)} className="cursor-pointer hover:bg-stone-50">
                    <td className="whitespace-nowrap px-5 py-2 font-mono text-stone-500">{time(e.at)}</td>
                    <td className="px-2 py-2"><Badge tone={statusTone(e)}>{e.kind === 'push' ? 'push' : e.status}</Badge></td>
                    <td className="whitespace-nowrap px-2 py-2 text-stone-700">{name(e.deviceId)}</td>
                    <td className="px-2 py-2 font-mono text-stone-800">{e.summary}</td>
                    <td className="px-5 py-2 text-right font-mono text-stone-500">{e.ms ?? ''}</td>
                  </tr>
                  {open === e.id && e.kind === 'request' && (
                    <tr className="bg-stone-50">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          {(['request', 'response'] as const).map((k) => (
                            <div key={k}>
                              <div className="mb-1 font-mono text-[11px] uppercase text-stone-500">
                                {k === 'request' ? `${e.method} /api${e.path}` : `response ${e.status}`}
                              </div>
                              <pre className={cx('max-h-64 overflow-auto rounded-lg bg-stone-900 p-3 font-mono text-[11px] text-stone-100')}>
                                {JSON.stringify(k === 'request' ? e.body : e.response, null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
