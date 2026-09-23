import { useEffect, useRef, useState } from 'react';
import { api, type AppConfig, type ClaimResponse, type ErrorBody, type Holder, type Snapshot, type Song } from '../lib/api';
import { fmtClock, fmtSec } from '../lib/format';
import { uuid } from '../lib/uuid';
import { Badge, Button, Dot, cx, inputCls } from './ui';

type Phase = 'idle' | 'playing' | 'paused' | 'lost';
type Device = Snapshot['devices'][number];
interface Notice { tone: 'green' | 'amber' | 'red' | 'zinc'; text: string }

const LOST_TEXT: Record<string, string> = {
  PREEMPTED: 'Another device took over this stream.',
  EXPIRED: 'Lease expired: no heartbeat reached the server in time.',
  ENDED: 'The session was ended.',
  PAUSED: 'The session is paused.',
  NOT_FOUND: 'The server has no such session for this device.',
};

export function DeviceIcon({ type, className }: { type: string; className?: string }) {
  const common = { className: cx('h-5 w-5', className), fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24' };
  switch (type) {
    case 'DESKTOP': return <svg {...common}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M1.5 19.5h21" strokeLinecap="round" /></svg>;
    case 'MOBILE': return <svg {...common}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" strokeLinecap="round" /></svg>;
    case 'TABLET': return <svg {...common}><rect x="4" y="2.5" width="16" height="19" rx="2" /><path d="M11 18.5h2" strokeLinecap="round" /></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" /></svg>;
  }
}

export function DevicePanel({ device, snapshot, songs, cfg, onChanged }: {
  device: Device; snapshot: Snapshot; songs: Song[]; cfg: AppConfig; onChanged: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [songId, setSongId] = useState<number>(songs[(device.deviceId - 1) % songs.length]?.songId ?? songs[0]!.songId);
  const [playingSongId, setPlayingSongId] = useState<number | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const [queuedBeats, setQueuedBeats] = useState(0);
  const [prompt, setPrompt] = useState<{ holders: Holder[] } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastBeat, setLastBeat] = useState<string | null>(null);

  // Intervals capture old closures; read the latest values through refs.
  const pos = useRef(0);
  pos.current = positionMs;
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  const song = songs.find((s) => s.songId === (playingSongId ?? songId));
  const mine = snapshot.sessions.find((s) => s.sessionId === sessionId);
  const others = snapshot.sessions.filter((s) => s.status === 'PLAYING' && s.deviceId !== device.deviceId);
  const serverDisagrees = phase === 'playing' && sessionId !== null && mine?.status !== 'PLAYING';

  function lose(reason: string) {
    const holder = snapRef.current.sessions.find((s) => s.status === 'PLAYING' && s.deviceId !== device.deviceId);
    setPhase('lost');
    setNotice({
      tone: 'red',
      text: reason === 'PREEMPTED' && holder ? `Playback moved to ${holder.deviceName}.` : LOST_TEXT[reason] ?? `Session lost (${reason}).`,
    });
    onChanged();
  }

  async function sendHeartbeat(sid: number) {
    const r = await api.post<{ leaseRemainingMs: number } & ErrorBody>('/playback/heartbeat',
      { sessionId: sid, deviceId: device.deviceId, positionMs: Math.round(pos.current) });
    if (r.ok) setLastBeat(`200 · lease ${fmtSec(r.body.leaseRemainingMs)}`);
    else if (r.status === 410) { setLastBeat(`410 ${r.body.reason}`); lose(r.body.reason ?? 'UNKNOWN'); }
    else setLastBeat(`${r.status}`);
  }

  // Simulated playback clock. A frozen (sleeping) device stops everything, including this.
  useEffect(() => {
    if (phase !== 'playing' || frozen) return;
    const id = setInterval(() => setPositionMs((p) => p + 250), 250);
    return () => clearInterval(id);
  }, [phase, frozen]);

  // End of track → release.
  useEffect(() => {
    if (phase === 'playing' && song && positionMs >= song.durationMs && sessionId) {
      void api.post('/playback/release', { sessionId, deviceId: device.deviceId, positionMs: song.durationMs }).then(() => {
        setPhase('idle'); setSessionId(null); setPositionMs(0);
        setNotice({ tone: 'zinc', text: 'Track finished.' });
        onChanged();
      });
    }
  }, [positionMs, phase, song, sessionId, device.deviceId, onChanged]);

  // Heartbeat loop. While frozen, beats are queued instead of sent.
  useEffect(() => {
    if (phase !== 'playing' || sessionId === null) return;
    const id = setInterval(() => {
      if (frozen) setQueuedBeats((n) => n + 1);
      else void sendHeartbeat(sessionId);
    }, cfg.heartbeatMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionId, frozen, cfg.heartbeatMs]);

  async function toggleFreeze() {
    if (!frozen) { setFrozen(true); setNotice({ tone: 'amber', text: 'Asleep: heartbeats are queued, not sent.' }); return; }
    setFrozen(false);
    setNotice(null);
    // Waking up: flush the stale heartbeat. If the session was taken over or the lease lapsed,
    // the fenced UPDATE matches 0 rows and the server answers 410.
    if (phase === 'playing' && sessionId !== null && queuedBeats > 0) {
      setQueuedBeats(0);
      await sendHeartbeat(sessionId);
    }
  }

  async function doClaim(mode: 'NORMAL' | 'TAKEOVER') {
    setBusy(true);
    setPrompt(null);
    const resume = phase === 'paused' && playingSongId === songId;
    const startAt = resume ? positionMs : 0;
    const r = await api.post<ClaimResponse & ErrorBody>('/playback/claim', {
      deviceId: device.deviceId, songId, mode, clientRequestId: uuid(), positionMs: startAt,
    });
    setBusy(false);
    if (r.status === 200 && r.body.outcome === 'GRANTED') {
      setSessionId(r.body.sessionId);
      setPlayingSongId(songId);
      setPositionMs(startAt);
      setPhase('playing');
      setQueuedBeats(0);
      setLastBeat(null);
      setNotice(r.body.preempted.length
        ? { tone: 'green', text: `Took over: preempted session #${r.body.preempted.join(', #')}.` }
        : { tone: 'green', text: `Granted session #${r.body.sessionId} (v${r.body.stateVersion}).` });
    } else if (r.status === 409 && r.body.outcome === 'REJECTED') {
      if (r.body.canTakeOver) setPrompt({ holders: r.body.holders });
      else setNotice({ tone: 'amber', text: `Stream limit reached (policy ${r.body.policy}). Playing on ${r.body.holders.map((h) => h.deviceName).join(', ')}.` });
    } else {
      setNotice({ tone: 'red', text: r.body.message ?? `Error ${r.status}` });
    }
    onChanged();
  }

  async function doDuplicate() {
    // Idempotency demo: two concurrent claims carrying the same clientRequestId.
    setBusy(true);
    const id = uuid();
    const body = { deviceId: device.deviceId, songId, mode: 'NORMAL', clientRequestId: id, positionMs: 0 };
    const [a, b] = await Promise.all([
      api.post<ClaimResponse & ErrorBody>('/playback/claim', body),
      api.post<ClaimResponse & ErrorBody>('/playback/claim', body),
    ]);
    setBusy(false);
    const desc = (x: typeof a) => (x.body.outcome === 'GRANTED' ? `#${x.body.sessionId}` : x.body.outcome ?? x.status);
    if (a.body.outcome === 'GRANTED') {
      setSessionId(a.body.sessionId); setPlayingSongId(songId); setPositionMs(0); setPhase('playing'); setQueuedBeats(0);
    }
    setNotice({ tone: desc(a) === desc(b) ? 'green' : 'red', text: `Same request sent twice → ${desc(a)} and ${desc(b)}${desc(a) === desc(b) ? ': one session (idempotent)' : ''}.` });
    onChanged();
  }

  async function doPauseOrStop(kind: 'pause' | 'release') {
    if (sessionId === null) return;
    setBusy(true);
    const r = await api.post<ErrorBody>(`/playback/${kind}`, { sessionId, deviceId: device.deviceId, positionMs: Math.round(positionMs) });
    setBusy(false);
    if (r.ok) {
      if (kind === 'pause') { setPhase('paused'); setNotice({ tone: 'zinc', text: 'Paused: the stream slot is free.' }); }
      else { setPhase('idle'); setSessionId(null); setPositionMs(0); setPlayingSongId(null); setNotice(null); }
    } else if (r.status === 410) {
      lose(r.body.reason ?? 'UNKNOWN');
    }
    onChanged();
  }

  const leaseMs = mine?.status === 'PLAYING' ? mine.leaseRemainingMs ?? 0 : 0;
  const leasePct = Math.max(0, Math.min(100, (leaseMs / cfg.leaseMs) * 100));
  const progressPct = song ? Math.min(100, (positionMs / song.durationMs) * 100) : 0;
  const statusBadge = {
    idle: <Badge>idle</Badge>,
    playing: <Badge tone="green"><Dot tone="green" pulse={!frozen} /> playing</Badge>,
    paused: <Badge tone="amber">paused</Badge>,
    lost: <Badge tone="red">session lost</Badge>,
  }[phase];

  return (
    <div className={cx(
      'flex flex-col rounded-xl border bg-zinc-900/60 transition-colors',
      phase === 'playing' && !frozen ? 'border-emerald-500/40 shadow-[0_0_30px_-12px] shadow-emerald-500/40' : 'border-zinc-800',
      frozen && 'border-sky-500/40',
      phase === 'lost' && 'border-rose-500/40',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className={cx('grid h-9 w-9 place-items-center rounded-lg', phase === 'playing' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-400')}>
            <DeviceIcon type={device.deviceType} />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">{device.deviceName}</div>
            <div className="text-[11px] text-zinc-500">device #{device.deviceId} · {device.deviceType.toLowerCase()}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {frozen && <Badge tone="sky">asleep</Badge>}
          {statusBadge}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Now playing elsewhere */}
        {others.length > 0 && phase !== 'playing' && (
          <div className="flex items-center gap-2 rounded-lg bg-zinc-800/60 px-3 py-2 text-xs text-zinc-300">
            <Dot tone="green" /> Now playing on <strong className="font-semibold">{others.map((o) => o.deviceName).join(', ')}</strong>
          </div>
        )}

        {/* Song + progress */}
        <div>
          <select className={inputCls} value={songId} onChange={(e) => setSongId(Number(e.target.value))} disabled={busy}>
            {songs.map((s) => <option key={s.songId} value={s.songId}>{s.title} · {s.artist}</option>)}
          </select>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className={cx('h-full rounded-full transition-[width] duration-200', phase === 'playing' ? 'bg-emerald-400' : 'bg-zinc-600')} style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-zinc-500">
            <span>{fmtClock(positionMs)}</span>
            <span>{song ? fmtClock(song.durationMs) : ''}</span>
          </div>
        </div>

        {/* Takeover prompt (policy ASK) */}
        {prompt && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-sm text-amber-200">Playing on <strong>{prompt.holders.map((h) => h.deviceName).join(', ')}</strong>. Take over?</div>
            <div className="mt-2 flex gap-2">
              <Button variant="primary" onClick={() => doClaim('TAKEOVER')} disabled={busy}>Take over</Button>
              <Button variant="ghost" onClick={() => setPrompt(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          {phase === 'playing' ? (
            <>
              <Button onClick={() => doPauseOrStop('pause')} disabled={busy || frozen}>❚❚ Pause</Button>
              <Button variant="danger" onClick={() => doPauseOrStop('release')} disabled={busy || frozen}>■ Stop</Button>
              {playingSongId !== songId && <Button variant="primary" onClick={() => doClaim('NORMAL')} disabled={busy || frozen}>Play this instead</Button>}
            </>
          ) : (
            <Button variant="primary" onClick={() => doClaim('NORMAL')} disabled={busy}>
              ▶ {phase === 'paused' && playingSongId === songId ? 'Resume' : 'Play'}
            </Button>
          )}
          <Button variant="ghost" onClick={toggleFreeze} className={cx(frozen && 'text-sky-300')} title="Stop heartbeats, like a laptop going to sleep">
            {frozen ? '☀ Wake' : '☾ Sleep'}
          </Button>
        </div>

        {notice && (
          <div className={cx('rounded-lg px-3 py-2 text-xs', {
            green: 'bg-emerald-500/10 text-emerald-200', amber: 'bg-amber-500/10 text-amber-200',
            red: 'bg-rose-500/10 text-rose-200', zinc: 'bg-zinc-800/70 text-zinc-300',
          }[notice.tone])}>{notice.text}</div>
        )}

        {/* Debug strip */}
        <div className="mt-auto space-y-2 border-t border-zinc-800/80 pt-3">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>lease (server)</span>
            <span className="tabular-nums">{mine?.status === 'PLAYING' ? fmtSec(leaseMs) : '—'}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className={cx('h-full rounded-full transition-[width] duration-700', leasePct > 33 ? 'bg-indigo-400' : 'bg-rose-400')} style={{ width: `${leasePct}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-500">
            <span>session</span><span className="text-right text-zinc-300">{sessionId ? `#${sessionId}` : '—'}</span>
            <span>last heartbeat</span><span className="text-right text-zinc-300">{lastBeat ?? '—'}</span>
            <span>queued beats</span><span className={cx('text-right', queuedBeats ? 'text-sky-300' : 'text-zinc-300')}>{queuedBeats}</span>
          </div>
          {serverDisagrees && !frozen && (
            <div className="text-[11px] text-amber-300/90">Server no longer lists this session as active; the next heartbeat will confirm.</div>
          )}
          <button onClick={doDuplicate} disabled={busy || phase === 'playing'} className="text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline disabled:opacity-40">
            Send duplicate claim (idempotency test)
          </button>
        </div>
      </div>
    </div>
  );
}
