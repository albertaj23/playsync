import { useDeviceSession } from '../../lib/useDeviceSession';
import type { Song } from '../../lib/api';
import { Button, Card, Dot } from '../ui';
import { NowPlaying } from './NowPlaying';
import { PlayerControls } from './PlayerControls';
import { describeMessage } from './deviceMessages';

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
  
  const icon = 
    device.deviceType === 'MOBILE' ? '📱' :
    device.deviceType === 'TABLET' ? '📲' :
    device.deviceType === 'WEB' ? '🌐' : '💻';

  let borderClass = 'border-stone-200';
  if (session.offline) borderClass = 'border-sky-400 ring-1 ring-sky-400';
  else if (session.phase === 'stopped') borderClass = 'border-rose-400 ring-1 ring-rose-400';
  else if (session.phase === 'playing') borderClass = 'border-emerald-400 ring-1 ring-emerald-400';

  const otherPlaying = session.snapshot?.sessions.find(s => s.status === 'PLAYING' && s.deviceId !== device.deviceId);
  const showOtherPlaying = otherPlaying && session.phase !== 'playing';

  return (
    <Card className={`${borderClass} ${large ? 'max-w-[28rem] mx-auto' : ''}`} padded={false}>
      <header className="flex items-center justify-between border-b border-stone-100 px-5 py-3 bg-stone-50/50 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h2 className="font-semibold text-stone-900">{device.deviceName}</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
          <Dot tone={session.connected ? 'green' : 'stone'} />
          {session.connected ? 'Online' : 'Offline'}
        </div>
      </header>

      <div className="p-5 space-y-6">
        {showOtherPlaying && (
          <div className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
            Playing on {otherPlaying.deviceName}
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

        {session.message && (() => {
          const m = describeMessage(session.message);
          const bg = m.tone === 'info' ? 'bg-violet-50 text-violet-900 border-violet-100' :
                     m.tone === 'warn' ? 'bg-amber-50 text-amber-900 border-amber-100' :
                     m.tone === 'bad' ? 'bg-rose-50 text-rose-900 border-rose-100' :
                     'bg-emerald-50 text-emerald-900 border-emerald-100';
                     
          return (
            <div className={`rounded-xl border p-4 ${bg} relative`}>
              <div className="pr-6">
                <h4 className="font-semibold text-sm">{m.title}</h4>
                {m.body && <p className="mt-1 text-sm opacity-90">{m.body}</p>}
              </div>
              
              {session.message.kind === 'ask' ? (
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" size="sm" onClick={session.takeOver} disabled={session.busy}>
                    Play here
                  </Button>
                  <Button variant="ghost" size="sm" onClick={session.dismiss} disabled={session.busy}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <button 
                  onClick={session.dismiss} 
                  className="absolute top-4 right-4 text-current opacity-50 hover:opacity-100"
                  title="Dismiss"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })()}

        {session.offline && (
          <div className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-800">
            This device is offline. Music is paused here; if it stays offline too long, or another device takes over, it will stop.
          </div>
        )}
      </div>
    </Card>
  );
}
