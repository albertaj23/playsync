import { Moon, Pause, Play, Square, Sun } from 'lucide-react';
import { Button } from '../ui';

export function PlayerControls({
  phase,
  songId,
  playingSongId,
  busy,
  offline,
  play,
  pause,
  stop,
  goOffline,
  comeOnline,
}: {
  phase: 'idle' | 'playing' | 'paused' | 'stopped';
  songId: number;
  playingSongId?: number;
  busy: boolean;
  offline: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  goOffline: () => void;
  comeOnline: () => void;
}) {
  const disablePlayback = busy || offline;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        {phase === 'playing' ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="secondary"
              onClick={pause}
              disabled={disablePlayback}
            >
              <Pause size={16} /> Pause
            </Button>
            <Button
              className="flex-1"
              variant="danger"
              onClick={stop}
              disabled={disablePlayback}
            >
              <Square size={14} /> Stop
            </Button>
            {songId !== playingSongId && (
              <Button
                className="flex-1 whitespace-nowrap"
                variant="play"
                onClick={play}
                disabled={disablePlayback}
              >
                <Play size={16} /> Play this instead
              </Button>
            )}
          </div>
        ) : (
          <Button
            className="w-full"
            variant="play"
            size="lg"
            onClick={play}
            disabled={disablePlayback}
          >
            <Play size={18} fill="currentColor" /> {phase === 'paused' && songId === playingSongId ? 'Resume' : 'Play'}
          </Button>
        )}
      </div>

      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={offline ? comeOnline : goOffline}
          title="Pretend this device lost its internet connection, like a laptop lid closing"
        >
          {offline ? <Sun size={14} /> : <Moon size={14} />} {offline ? 'Back online' : 'Go offline'}
        </Button>
      </div>
    </div>
  );
}
