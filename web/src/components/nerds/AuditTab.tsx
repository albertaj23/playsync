import { type EventRow } from '../../lib/api';
import { Badge, Card, type Tone } from '../ui';

function renderDetail(row: EventRow) {
  const d = row.detail as {
    mode?: string; preempted?: { sessionId: number }[]; holders?: { deviceName: string }[];
    bySessionId?: number; reason?: string; positionMs?: number; by?: string;
  } | null;
  let text = '';
  if (d) {
    switch (row.type) {
      case 'CLAIM_GRANTED':
        text = d.mode || '';
        if (d.preempted && d.preempted.length > 0) {
          text += ` preempted ${d.preempted.map((p) => `#${p.sessionId}`).join(', ')}`;
        }
        break;
      case 'CLAIM_REJECTED':
        if (d.holders && d.holders.length > 0) {
          text = `held by ${d.holders.map((h) => h.deviceName).join(', ')}`;
        }
        break;
      case 'PREEMPTED':
        text = `by session #${d.bySessionId}`;
        break;
      case 'HEARTBEAT_REJECTED':
        text = `reason ${d.reason}`;
        break;
      case 'PAUSED':
      case 'RELEASED':
        if (typeof d.positionMs === 'number') {
          text = `at ${(d.positionMs / 1000).toFixed(1)}s`;
        } else if (d.by) {
          text = d.by;
        }
        break;
    }
  }
  return (
    <div className="flex items-center gap-2">
      <span>{text}</span>
      {row.clientRequestId && (
        <span className="font-mono text-[10px] text-stone-400" title={row.clientRequestId}>
          {row.clientRequestId.slice(0, 8)}
        </span>
      )}
    </div>
  );
}

function getEventTone(type: string): Tone {
  switch (type) {
    case 'CLAIM_GRANTED': return 'green';
    case 'CLAIM_REJECTED': return 'amber';
    case 'PREEMPTED':
    case 'EXPIRED':
    case 'HEARTBEAT_REJECTED': return 'red';
    case 'PAUSED': return 'sky';
    case 'RELEASED': return 'stone';
    default: return 'stone';
  }
}

export function AuditTab({ events }: { events: EventRow[] }) {
  return (
    <Card title="Audit log" subtitle="playback_event, newest first (DB clock, UTC)" padded={false}>
      {events.length === 0 ? (
        <p className="px-5 py-5 text-sm text-stone-500">No events yet.</p>
      ) : (
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-left font-mono text-xs min-w-[800px]">
            <thead className="bg-[var(--surface)] text-[11px] uppercase text-stone-500 sticky top-0 shadow-sm">
              <tr>
                {['time', 'event', 'device name', 'session', 'version', 'detail'].map((h) => (
                  <th key={h} className="px-5 py-2 font-medium bg-stone-50">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {events.map((e) => (
                <tr key={e.eventId}>
                  <td className="px-5 py-2 whitespace-nowrap">{e.at}</td>
                  <td className="px-5 py-2"><Badge tone={getEventTone(e.type)}>{e.type}</Badge></td>
                  <td className="px-5 py-2 font-sans">{e.deviceName}</td>
                  <td className="px-5 py-2">{e.sessionId ? `#${e.sessionId}` : '—'}</td>
                  <td className="px-5 py-2">v{e.stateVersion}</td>
                  <td className="px-5 py-2">{renderDetail(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
