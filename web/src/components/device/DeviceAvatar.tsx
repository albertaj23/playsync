import { Laptop, Smartphone, Tablet, Globe } from 'lucide-react';

export type AvatarMood = 'idle' | 'playing' | 'paused' | 'waiting' | 'moved' | 'offline' | 'stopped';

const body: Record<AvatarMood, string> = {
  idle: 'bg-fg/8 text-stone-600',
  playing: 'bg-emerald-500/20 text-emerald-400',
  paused: 'bg-amber-500/20 text-amber-400',
  waiting: 'bg-amber-500/20 text-amber-400',
  moved: 'bg-sky-500/20 text-sky-400',
  offline: 'bg-sky-500/15 text-sky-400',
  stopped: 'bg-rose-500/15 text-rose-400',
};

const mouths: Record<AvatarMood, string> = {
  idle: 'M9 20 Q14 23 19 20',
  playing: 'M8 19 Q14 27 20 19 Z',
  paused: 'M10 21 L18 21',
  waiting: 'M9 22 Q14 18 19 22',
  moved: 'M14 19 m-3 0 a3 3.4 0 1 0 6 0 a3 3.4 0 1 0 -6 0',
  offline: 'M11 21 Q14 22 17 21',
  stopped: 'M9 22 Q14 17 19 22',
};

/** A device as a little character: face reacts to what the device is doing. */
export function DeviceAvatar({ type, mood, size = 44 }: { type: string; mood: AvatarMood; size?: number }) {
  const Icon = type === 'MOBILE' ? Smartphone : type === 'TABLET' ? Tablet : type === 'WEB' ? Globe : Laptop;
  const asleep = mood === 'offline';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className={`grid h-full w-full place-items-center rounded-[38%] ${body[mood]} ${mood === 'playing' ? 'bob' : ''}`}>
        <svg viewBox="0 0 28 28" width={size * 0.72} height={size * 0.72} aria-hidden>
          {asleep ? (
            <>
              <path d="M6 12 Q9 15 12 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M16 12 Q19 15 22 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <g className="blink" fill="currentColor">
              <ellipse cx="9.5" cy="12" rx="2.2" ry={mood === 'moved' ? 3 : 2.6} />
              <ellipse cx="18.5" cy="12" rx="2.2" ry={mood === 'moved' ? 3 : 2.6} />
            </g>
          )}
          <path d={mouths[mood]} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill={mood === 'playing' || mood === 'moved' ? 'currentColor' : 'none'} />
        </svg>
      </div>
      <span className="surface absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full text-stone-600 shadow ring-1 ring-fg/10">
        <Icon size={11} />
      </span>
      {asleep && <span className="floatz absolute -top-2 right-0 text-xs font-bold text-sky-400">z</span>}
    </div>
  );
}
