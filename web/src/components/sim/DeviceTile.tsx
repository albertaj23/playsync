import { Moon, Smartphone, Laptop, Tablet, Globe, TriangleAlert } from 'lucide-react';
import { Equalizer, cx } from '../ui';
import type { VDeviceState } from '../../lib/sim';

const look: Record<VDeviceState, string> = {
  IDLE: 'border-fg/10 text-stone-500',
  PRESSING: 'border-amber-500/60 bg-amber-500/10 text-amber-400 animate-pulse',
  PLAYING: 'border-emerald-500/60 bg-emerald-500/12 text-emerald-400',
  REJECTED: 'border-fg/15 bg-fg/8 text-stone-500 sim-shake',
  RETRYING: 'border-amber-500/60 bg-amber-500/10 text-amber-400',
  FAILED: 'border-rose-500/60 text-rose-400 sim-striped',
  MOVED: 'border-sky-500/50 bg-sky-500/10 text-sky-400',
  OFFLINE: 'border-fg/10 bg-fg/5 text-stone-400 opacity-60',
};

const icons = { MOBILE: Smartphone, TABLET: Tablet, DESKTOP: Laptop, WEB: Globe } as const;

export function DeviceTile({ name, type, state, song, retries }: { name: string; type: string; state: VDeviceState; song?: string; retries?: number }) {
  const Icon = state === 'OFFLINE' ? Moon : state === 'FAILED' ? TriangleAlert : (icons[type as keyof typeof icons] ?? Laptop);
  return (
    <div className={cx('flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 text-xs transition-colors duration-300', look[state])} title={`${name}: ${state.toLowerCase()}`}>
      <Icon size={14} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-stone-800">{name}</div>
        {state === 'PLAYING' && song && <div className="truncate text-[10px] opacity-80">{song}</div>}
        {state === 'PRESSING' && <div className="text-[10px]">Connecting…</div>}
        {state === 'RETRYING' && <div className="text-[10px]">Trying again{retries ? ` (${retries})` : ''}</div>}
      </div>
      {state === 'PLAYING' && <Equalizer />}
    </div>
  );
}

const heat: Record<VDeviceState, string> = {
  IDLE: 'bg-fg/12', PRESSING: 'bg-amber-400', PLAYING: 'bg-emerald-500', REJECTED: 'bg-stone-400',
  RETRYING: 'bg-amber-500', FAILED: 'bg-rose-500', MOVED: 'bg-sky-500', OFFLINE: 'bg-fg/25',
};

export function HeatCell({ state, title }: { state: VDeviceState; title: string }) {
  return <span title={title} className={cx('h-2.5 w-2.5 rounded-[3px] transition-colors duration-300', heat[state])} />;
}
