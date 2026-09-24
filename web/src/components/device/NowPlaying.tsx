import { type Song } from '../../lib/api';
import { fmtClock } from '../../lib/format';
import { Equalizer, inputCls } from '../ui';

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

  // Progress bar logic
  const duration = displaySong?.durationMs || 1;
  const progressPercent = Math.min(100, Math.max(0, (positionMs / duration) * 100));
  const isPlaying = phase === 'playing';

  return (
    <div className="space-y-4">
      <select
        className={`${inputCls} text-sm`}
        value={songId}
        onChange={(e) => setSongId(Number(e.target.value))}
        disabled={busy}
      >
        {songs.map((s) => (
          <option key={s.songId} value={s.songId}>
            {s.title} — {s.artist}
          </option>
        ))}
      </select>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="h-10 w-10 shrink-0 rounded bg-stone-100 flex items-center justify-center text-xl shadow-inner">
            🎵
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium text-stone-900">{displaySong?.title}</h3>
              {isPlaying && !offline && <Equalizer className="text-emerald-500" />}
            </div>
            <p className="truncate text-xs text-stone-500">{displaySong?.artist}</p>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
          <div
            className={`h-full transition-all duration-500 ease-linear ${isPlaying ? 'bg-emerald-500' : 'bg-stone-300'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-medium text-stone-400 font-mono">
          <span>{fmtClock(positionMs)}</span>
          <span>{fmtClock(displaySong?.durationMs || 0)}</span>
        </div>
      </div>
    </div>
  );
}
