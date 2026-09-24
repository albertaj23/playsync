import { useEffect, useRef } from 'react';
import { useDeviceSession } from '../../lib/useDeviceSession';
import type { Song } from '../../lib/api';
import { Button, Dot } from '../ui';
import { NowPlaying } from './NowPlaying';
import { PlayerControls } from './PlayerControls';
import { describeMessage } from './deviceMessages';
import { useAnime } from '../../lib/useAnime';
import { animate } from 'animejs';
import { AskSheet } from './AskSheet';
import { DeviceAvatar, type AvatarMood } from './DeviceAvatar';
import { celebrate, pop, reduced } from '../../lib/motion';

let celebrated = false;

const PHASE_COLORS = {
  playing: '#34d399',  // emerald-400
  stopped: '#fb7185',  // rose-400
  paused:  '#fbbf24',  // amber-400
  idle:    'rgba(140,120,150,0.3)',
  offline: '#38bdf8',  // sky-400
} as const;

export function DeviceCard({
  accountId,
  device,
  songs,
  heartbeatMs,
  large,
}: {
  accountId: number;
  device: { deviceId: number; deviceName: string; deviceType: string };
  songs: Song[];
  heartbeatMs: number;
  large?: boolean;
}) {
  const session = useDeviceSession({ accountId, deviceId: device.deviceId, songs, heartbeatMs });
  const cardRef = useRef<HTMLElement>(null);
  const { animRef, animate: scopedAnimate } = useAnime();

  // Determine key state
  const stateKey = session.offline ? 'offline' : (session.phase as keyof typeof PHASE_COLORS);
  const borderColor = PHASE_COLORS[stateKey] ?? PHASE_COLORS.idle;

  // Animate border color on state change
  useEffect(() => {
    if (!cardRef.current) return;
    const glow = stateKey === 'playing' ? '0 0 0 1px rgba(52,211,153,0.25), 0 0 20px -6px rgba(52,211,153,0.3)'
               : stateKey === 'offline'  ? '0 0 0 1px rgba(56,189,248,0.20), 0 0 16px -6px rgba(56,189,248,0.25)'
               : stateKey === 'stopped'  ? '0 0 0 1px rgba(251,113,133,0.20), 0 0 16px -6px rgba(251,113,133,0.2)'
               : '0 0 0 0 rgba(0,0,0,0)';
    animate(cardRef.current, {
      borderColor,
      boxShadow: glow,
      duration: 500,
      ease: 'outQuad',
    });
  }, [stateKey, borderColor]);

  const avatarRef = useRef<HTMLDivElement>(null);
  const mood: AvatarMood = session.offline ? 'offline'
    : session.message?.kind === 'moved' ? 'moved'
    : session.busy ? 'waiting'
    : session.phase === 'playing' ? 'playing'
    : session.phase === 'paused' ? 'paused'
    : session.phase === 'stopped' ? 'stopped' : 'idle';

  // Bounce the avatar on every state change; confetti only for the first time playback starts.
  const prevPhase = useRef(session.phase);
  useEffect(() => {
    if (prevPhase.current === session.phase) return;
    pop(avatarRef.current);
    if (session.phase === 'playing' && !celebrated && !reduced()) { celebrated = true; celebrate(avatarRef.current); }
    prevPhase.current = session.phase;
  }, [session.phase]);


  // Slide-in message banner
  useEffect(() => {
    if (session.message) {
      scopedAnimate('.message-banner', {
        opacity: [0, 1],
        translateY: [-12, 0],
        scale: [0.97, 1],
        duration: 380,
        ease: 'outBack',
      });
    }
  }, [session.message, scopedAnimate]);

  const otherPlaying = session.snapshot?.sessions.find(s => s.status === 'PLAYING' && s.deviceId !== device.deviceId);
  const showOtherPlaying = otherPlaying && session.phase !== 'playing';

  // Phase badge color
  const phaseTone = session.offline ? 'text-sky-400 bg-sky-500/10 ring-sky-500/20'
    : session.phase === 'playing'   ? 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20'
    : session.phase === 'paused'    ? 'text-amber-400 bg-amber-500/10 ring-amber-500/20'
    : session.phase === 'stopped'   ? 'text-rose-400 bg-rose-500/10 ring-rose-500/20'
    : 'text-stone-500 bg-stone-200/60 ring-stone-300/50';

  return (
    <section
      ref={(el) => { (cardRef as any).current = el; (animRef as any).current = el; }}
      style={{ borderColor: PHASE_COLORS.idle }}
      className={`glass-card rounded-3xl border overflow-hidden transition-colors ${large ? 'max-w-[28rem] mx-auto' : ''}`}
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-fg/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <div ref={avatarRef}><DeviceAvatar type={device.deviceType} mood={mood} /></div>
          <h2 className="font-semibold text-stone-900 text-base tracking-tight">{device.deviceName}</h2>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset tracking-wide ${phaseTone}`}>
            {session.offline ? 'Napping' : session.phase === 'playing' ? 'Playing' : session.phase === 'paused' ? 'Paused' : session.phase === 'stopped' ? 'Stopped' : 'Ready'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-stone-400">
          <Dot tone={session.connected ? 'green' : 'stone'} />
          {session.connected ? 'Online' : 'Offline'}
        </div>
      </header>

      <div className="p-4 space-y-5">
        {showOtherPlaying && (
          <div className="inline-flex items-center rounded-full bg-stone-200/80 px-2.5 py-1 text-xs font-medium text-stone-500 ring-1 ring-fg/6">
            🎧 Playing on {otherPlaying.deviceName}
          </div>
        )}

        <NowPlaying
          songs={songs}
          songId={session.songId}
          setSongId={session.setSongId}
          playingSong={session.playingSong}
          busy={session.busy}
          phase={session.phase}
          offline={session.offline}
          positionMs={session.positionMs}
        />

        <PlayerControls
          phase={session.phase}
          songId={session.songId}
          playingSongId={session.playingSongId ?? undefined}
          busy={session.busy}
          offline={session.offline}
          play={session.play}
          pause={session.pause}
          stop={session.stop}
          goOffline={session.goOffline}
          comeOnline={session.comeOnline}
        />

        <AskSheet
          open={session.message?.kind === 'ask'}
          title={session.message ? describeMessage(session.message).title : ''}
          body={session.message ? describeMessage(session.message).body : undefined}
          busy={session.busy}
          onConfirm={session.takeOver}
          onCancel={session.dismiss}
        />
        {session.message && session.message.kind !== 'ask' && (() => {
          const m = describeMessage(session.message);
          const bg = m.tone === 'info' ? 'bg-violet-500/10 text-violet-300 border-violet-500/20'
                   : m.tone === 'warn' ? 'bg-amber-500/10  text-amber-300  border-amber-500/20'
                   : m.tone === 'bad'  ? 'bg-rose-500/10   text-rose-300   border-rose-500/20'
                   : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
          return (
            <div className={`message-banner rounded-xl border p-4 ${bg} relative`}>
              <div className="pr-6">
                <h4 className="font-semibold text-sm">{m.title}</h4>
                {m.body && <p className="mt-1 text-sm opacity-80">{m.body}</p>}
              </div>
                <button
                  onClick={session.dismiss}
                  className="absolute top-4 right-4 text-current opacity-40 hover:opacity-80 transition-opacity"
                  title="Dismiss"
                >
                  ✕
                </button>
            </div>
          );
        })()}

        {session.offline && (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 p-4 text-sm text-sky-400">
            😴 This device is napping (offline). If it stays away too long, or another device takes over, its spot will be let go.
          </div>
        )}
      </div>
    </section>
  );
}
