import { useState } from 'react';
import { api, type ChecksResponse, type ClaimResponse, type ErrorBody } from '../../lib/api';
import type { LiveSnapshot } from '../../lib/socket';
import { uuid } from '../../lib/uuid';
import { Button, Card, cx } from '../ui';

export interface CheckRun { at: number; allPassed: boolean; failed: string[]; after?: string }

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

export function ChecksTab({ checks, history, snapshot, onRunNow }: {
  checks: ChecksResponse | null; history: CheckRun[]; snapshot: LiveSnapshot | null; onRunNow: () => void;
}) {
  const [probe, setProbe] = useState<string | null>(null);

  // Idempotency probe: the same claim (same clientRequestId) sent twice concurrently.
  async function runProbe() {
    if (!snapshot) return;
    const busyDevices = new Set(snapshot.sessions.map((s) => s.deviceId));
    const device = snapshot.devices.find((d) => !busyDevices.has(d.deviceId)) ?? snapshot.devices[0]!;
    const body = { deviceId: device.deviceId, songId: 1, mode: 'NORMAL', clientRequestId: uuid(), positionMs: 0 };
    const [a, b] = await Promise.all([
      api.post<ClaimResponse & ErrorBody>('/playback/claim', body),
      api.post<ClaimResponse & ErrorBody>('/playback/claim', body),
    ]);
    const d = (x: typeof a) => (x.body.outcome === 'GRANTED' ? `GRANTED #${x.body.sessionId}` : x.body.outcome ?? String(x.status));
    const same = d(a) === d(b);
    setProbe(`${device.deviceName}, one request id sent twice: ${d(a)} and ${d(b)}. ${same ? 'Identical answers, so one effect (idempotent).' : 'Answers differ!'}`);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-stone-600">
            SQL assertions from <code className="font-mono text-xs">GET /api/accounts/:id/checks</code>, re-run after every push and every
            traced action.
          </p>
          <Button size="sm" onClick={onRunNow}>Run now</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(checks?.checks ?? []).map((c) => (
            <div key={c.id} className={cx('rounded-xl border p-4', c.passed ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-300 bg-rose-50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-stone-900">{c.passed ? '✓' : '✗'} {c.title}</div>
                <span className="font-mono text-[10px] text-stone-400">{c.id}</span>
              </div>
              <p className="mt-1 text-xs text-stone-600">{c.meaning}</p>
              <p className={cx('mt-2 font-mono text-xs', c.passed ? 'text-emerald-700' : 'text-rose-700')}>{c.detail}</p>
            </div>
          ))}
          {!checks && <p className="text-sm text-stone-500">Running checks…</p>}
        </div>

        <Card title="Probe: idempotency" subtitle="Sends one Play request twice at the same time with the same request id">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={runProbe} disabled={!snapshot}>Send duplicate request</Button>
            {probe && <span className="text-sm text-stone-700">{probe}</span>}
          </div>
        </Card>
      </div>

      <Card title="Check history" subtitle="Newest first" padded={false}>
        <ol className="max-h-[32rem] divide-y divide-stone-100 overflow-auto">
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="px-5 py-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className={cx('font-medium', h.allPassed ? 'text-emerald-700' : 'text-rose-700')}>
                  {h.allPassed ? '✓ all 6 passed' : `✗ ${h.failed.join(', ')}`}
                </span>
                <span className="font-mono text-stone-400">{time(h.at)}</span>
              </div>
              {h.after && <div className="mt-0.5 truncate font-mono text-stone-500" title={h.after}>after: {h.after}</div>}
            </li>
          ))}
          {history.length === 0 && <li className="px-5 py-4 text-sm text-stone-500">No runs yet.</li>}
        </ol>
      </Card>
    </div>
  );
}
