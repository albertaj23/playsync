import { useRef, useState } from 'react';
import { DeviceCard } from '../../components/device/DeviceCard';
import { DeviceAvatar } from '../../components/device/DeviceAvatar';
import { cx } from '../../components/ui';
import type { Song, Snapshot } from '../../lib/api';
import type { DeviceMessage } from '../../lib/useDeviceSession';

/**
 * Household status strip (sticky within the chapter) + the device deck. All cards stay mounted at
 * all times: each owns heartbeats and a socket. Compact/expanded is only a prop; on phones the deck
 * is a horizontal snap carousel with page dots.
 */
export function ScreensChapter({ accountId, snapshot, songs, heartbeatMs, onEvent }: {
  accountId: number; snapshot: Snapshot; songs: Song[]; heartbeatMs: number; onEvent: (m: DeviceMessage) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const deck = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const playing = snapshot.sessions.filter((s) => s.status === 'PLAYING');
  const names = Array.from(new Set(playing.map((s) => s.deviceName)));
  const over = playing.length > snapshot.maxStreams;
  const status = names.length === 0 ? 'Nothing is playing yet. Pick a screen and tap Play 🎵'
    : names.length === 1 ? `Playing on ${names[0]}`
    : `Playing on ${names.slice(0, -1).join(', ')} and ${names.at(-1)} (${names.length} of ${snapshot.maxStreams} allowed)`;
  const first = snapshot.devices[0];

  return (
    <div>
      <div className="sticky top-[calc(var(--topbar-h)+8px)] z-10 mb-4">
        <div className={cx('glass-card flex items-center gap-3 rounded-2xl border px-4 py-2.5', over ? 'border-rose-500/50' : 'border-transparent')}>
          {first && <DeviceAvatar type={first.deviceType} mood={over ? 'stopped' : names.length ? 'playing' : 'idle'} size={34} />}
          <p className="min-w-0 truncate text-sm font-semibold text-stone-800">{status}</p>
        </div>
      </div>

      <div ref={deck} onScroll={(e) => { const el = e.currentTarget; setPage(Math.round(el.scrollLeft / (el.firstElementChild?.clientWidth ?? 1))); }}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 xl:grid-cols-4">
        {snapshot.devices.map((d) => (
          <div key={d.deviceId} className="device-card w-[82%] shrink-0 snap-center md:w-auto">
            <DeviceCard accountId={accountId} device={d} songs={songs} heartbeatMs={heartbeatMs}
              compact expanded={expanded === d.deviceId} onToggle={() => setExpanded((e) => (e === d.deviceId ? null : d.deviceId))} onEvent={onEvent} />
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-1.5 md:hidden" aria-hidden>
        {snapshot.devices.map((d, i) => {
          const isPlaying = playing.some((s) => s.deviceId === d.deviceId);
          return <span key={d.deviceId} className={cx('h-2 rounded-full transition-all', i === page ? 'w-5' : 'w-2', isPlaying ? 'bg-emerald-500' : 'bg-fg/25')} />;
        })}
      </div>
    </div>
  );
}
