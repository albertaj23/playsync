import { type Song } from '../../lib/api';
import { fmtClock } from '../../lib/format';
import { Equalizer, inputCls } from '../ui';

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

export function NowPlaying({
  songs,
  songId,
  setSongId,
  playingSong,
  busy,
  phase,
  offline,
  positionMs,
}: {
  songs: Song[];
  songId: number;
  setSongId: (id: number) => void;
  playingSong?: Song;
  busy: boolean;
  phase: 'idle' | 'playing' | 'paused' | 'stopped';
  offline: boolean;
  positionMs: number;
}) {
  const selectedSong = songs.find((s) => s.songId === songId) || songs[0];
  const displaySong = playingSong ?? selectedSong;

  const duration = displaySong?.durationMs || 1;
  const progressPercent = Math.min(100, Math.max(0, (positionMs / duration) * 100));
  const isPlaying = phase === 'playing';

  const hue = displaySong ? hashStr(displaySong.title) % 360 : 200;
  const hue2 = (hue + 50) % 360;

  return (
    <div className="space-y-4">
      <select
        className={inputCls + ' text-xs'}
        value={songId}
        onChange={(e) => setSongId(Number(e.target.value))}
        disabled={busy}
      >
        {songs.map((s) => (
          <option key={s.songId} value={s.songId} className="bg-stone-100">
            {s.title} — {s.artist}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-3">
        {/* Album art — deterministic gradient */}
        <div
          className={`h-11 w-11 shrink-0 rounded-lg shadow-lg ${isPlaying && !offline ? 'pulse-ring' : ''}`}
          style={{ background: `linear-gradient(135deg, hsl(${hue},65%,45%), hsl(${hue2},70%,35%))` }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-stone-900">{displaySong?.title}</h3>
            {isPlaying && !offline && <Equalizer className="text-emerald-400 shrink-0" />}
          </div>
          <p className="truncate text-xs text-stone-400">{displaySong?.artist}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-fg/8">
          <div
            className="h-full rounded-full transition-all duration-500 ease-linear"
            style={{
              width: `${progressPercent}%`,
              background: isPlaying
                ? `linear-gradient(90deg, hsl(${hue},60%,55%), hsl(${hue2},65%,50%))`
                : 'rgba(113,113,122,0.5)',
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-medium text-stone-500 font-mono tabular-nums">
          <span>{fmtClock(positionMs)}</span>
          <span>{fmtClock(displaySong?.durationMs || 0)}</span>
        </div>
      </div>
    </div>
  );
}
