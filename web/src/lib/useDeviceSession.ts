import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ClaimResponse, type ErrorBody, type Song } from './api';
import { useAccountState, type SessionLost } from './socket';
import { uuid } from './uuid';

export type Phase = 'idle' | 'playing' | 'paused' | 'stopped';

/** What the device should tell its user. Rendered in plain language by deviceMessages.ts. */
export type DeviceMessage =
  | { kind: 'ask'; holders: string[] }
  | { kind: 'busy'; holders: string[] }
  | { kind: 'moved'; to?: string; whileOffline: boolean }
  | { kind: 'timedOut'; whileOffline: boolean }
  | { kind: 'endedElsewhere' }
  | { kind: 'finished' }
  | { kind: 'error'; text: string };

/**
 * Everything one device client does: claim, pause, stop, heartbeats, going offline, and
 * reacting when the server says its session is gone. Each device uses its own socket.
 */
export function useDeviceSession(opts: { accountId: number | null; deviceId: number; songs: Song[]; heartbeatMs: number }) {
  const { accountId, deviceId, songs, heartbeatMs } = opts;

  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [songId, setSongId] = useState<number>(songs[(deviceId - 1) % Math.max(1, songs.length)]?.songId ?? 1);
  const [playingSongId, setPlayingSongId] = useState<number | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [offline, setOffline] = useState(false);
  const [queuedBeats, setQueuedBeats] = useState(0);
  const [message, setMessage] = useState<DeviceMessage | null>(null);
  const [busy, setBusy] = useState(false);

  // Timers and socket callbacks capture old closures; read current values through refs.
  const sessionRef = useRef<number | null>(null);
  sessionRef.current = sessionId;
  const positionRef = useRef(0);
  positionRef.current = positionMs;

  const markLost = useCallback((reason: string, whileOffline: boolean, by?: string) => {
    setPhase('stopped');
    setSessionId(null);
    if (reason === 'PREEMPTED') setMessage({ kind: 'moved', to: by, whileOffline });
    else if (reason === 'EXPIRED') setMessage({ kind: 'timedOut', whileOffline });
    else setMessage({ kind: 'endedElsewhere' });
  }, []);

  const onSessionLost = useCallback((p: SessionLost) => {
    if (p.sessionId === sessionRef.current) markLost(p.reason, false, p.byDeviceName);
  }, [markLost]);

  const { snapshot, connected } = useAccountState({ accountId, deviceId, enabled: !offline, onSessionLost });

  // After a page reload, pick up this device's session if the server still has one.
  const adopted = useRef(false);
  useEffect(() => {
    if (!snapshot || adopted.current) return;
    adopted.current = true;
    const mine = snapshot.sessions.find((s) => s.deviceId === deviceId);
    if (mine && sessionRef.current === null) {
      setSessionId(mine.sessionId);
      setSongId(mine.songId);
      setPlayingSongId(mine.songId);
      setPositionMs(mine.positionMs);
      setPhase(mine.status === 'PLAYING' ? 'playing' : 'paused');
    }
  }, [snapshot, deviceId]);

  const sendHeartbeat = useCallback(async (sid: number, afterOffline: boolean) => {
    const r = await api.post<ErrorBody>('/playback/heartbeat',
      { sessionId: sid, deviceId, positionMs: Math.round(positionRef.current) });
    if (r.status === 410 && sessionRef.current === sid) markLost(r.body.reason ?? 'ENDED', afterOffline, r.body.byDeviceName);
  }, [deviceId, markLost]);

  // Simulated playback clock (stops while offline, like a sleeping laptop).
  useEffect(() => {
    if (phase !== 'playing' || offline) return;
    const t = setInterval(() => setPositionMs((p) => p + 250), 250);
    return () => clearInterval(t);
  }, [phase, offline]);

  // Heartbeats keep the lease alive. While offline they pile up instead of being sent.
  useEffect(() => {
    if (phase !== 'playing' || sessionId === null) return;
    const t = setInterval(() => {
      if (offline) setQueuedBeats((n) => n + 1);
      else void sendHeartbeat(sessionId, false);
    }, heartbeatMs);
    return () => clearInterval(t);
  }, [phase, sessionId, offline, heartbeatMs, sendHeartbeat]);

  // End of the track: release the stream.
  const playingSong = songs.find((s) => s.songId === playingSongId);
  useEffect(() => {
    if (phase !== 'playing' || !playingSong || sessionId === null || positionMs < playingSong.durationMs) return;
    void api.post('/playback/release', { sessionId, deviceId, positionMs: playingSong.durationMs }).then(() => {
      setPhase('idle'); setSessionId(null); setPositionMs(0); setPlayingSongId(null);
      setMessage({ kind: 'finished' });
    });
  }, [phase, playingSong, sessionId, positionMs, deviceId]);

  async function play(mode: 'NORMAL' | 'TAKEOVER' = 'NORMAL') {
    setBusy(true);
    setMessage(null);
    const resuming = phase === 'paused' && playingSongId === songId;
    const startAt = resuming ? positionMs : 0;
    const r = await api.post<ClaimResponse & ErrorBody>('/playback/claim',
      { deviceId, songId, mode, clientRequestId: uuid(), positionMs: startAt });
    setBusy(false);
    if (r.status === 200 && r.body.outcome === 'GRANTED') {
      setSessionId(r.body.sessionId);
      setPlayingSongId(songId);
      setPositionMs(startAt);
      setQueuedBeats(0);
      setPhase('playing');
    } else if (r.status === 409 && r.body.outcome === 'REJECTED') {
      const holders = r.body.holders.map((h) => h.deviceName);
      setMessage(r.body.canTakeOver ? { kind: 'ask', holders } : { kind: 'busy', holders });
    } else {
      setMessage({ kind: 'error', text: r.body.message ?? `Something went wrong (${r.status}).` });
    }
  }

  async function pauseOrStop(kind: 'pause' | 'release') {
    if (sessionId === null) return;
    setBusy(true);
    const r = await api.post<ErrorBody>(`/playback/${kind}`, { sessionId, deviceId, positionMs: Math.round(positionMs) });
    setBusy(false);
    if (r.ok && kind === 'pause') setPhase('paused');
    else if (r.ok) { setPhase('idle'); setSessionId(null); setPositionMs(0); setPlayingSongId(null); setMessage(null); }
    else if (r.status === 410) markLost(r.body.reason ?? 'ENDED', false, r.body.byDeviceName);
  }

  function goOffline() { setOffline(true); }

  async function comeOnline() {
    setOffline(false);
    // Deliver the heartbeat that was due while offline. If the session was taken over or
    // timed out meanwhile, the server refuses it and this device stops.
    if (phase === 'playing' && sessionId !== null && queuedBeats > 0) {
      setQueuedBeats(0);
      await sendHeartbeat(sessionId, true);
    }
  }

  return {
    snapshot, connected, phase, sessionId, songId, setSongId, playingSongId, playingSong, positionMs,
    offline, queuedBeats, message, busy,
    play: () => play('NORMAL'),
    takeOver: () => play('TAKEOVER'),
    pause: () => pauseOrStop('pause'),
    stop: () => pauseOrStop('release'),
    goOffline, comeOnline,
    dismiss: () => setMessage(null),
  };
}
