import { Ban, Bomb, Moon, Repeat, RotateCcw, ShieldAlert, ShieldCheck, Wrench, X } from 'lucide-react';
import type { SimEvent } from '../../lib/sim';
import { cx } from '../ui';

const ICON: Record<string, { Icon: typeof Ban; tone: string }> = {
  reject: { Icon: Ban, tone: 'bg-fg/10 text-stone-500' },
  move: { Icon: Repeat, tone: 'bg-sky-500/15 text-sky-400' },
  crash: { Icon: Bomb, tone: 'bg-rose-500/15 text-rose-400' },
  fail: { Icon: X, tone: 'bg-rose-500/15 text-rose-400' },
  violation: { Icon: ShieldAlert, tone: 'bg-rose-500/20 text-rose-400' },
  cleared: { Icon: ShieldCheck, tone: 'bg-emerald-500/15 text-emerald-400' },
  switch: { Icon: RotateCcw, tone: 'bg-violet-500/15 text-violet-400' },
  repair: { Icon: Wrench, tone: 'bg-emerald-500/15 text-emerald-400' },
  offline: { Icon: Moon, tone: 'bg-sky-500/15 text-sky-400' },
  expired: { Icon: Moon, tone: 'bg-amber-500/15 text-amber-400' },
};
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Phone-notification style stream of what is happening to the listeners, newest first. */
export function FeedbackFeed({ events, className }: { events: SimEvent[]; className?: string }) {
  const shown = events.slice(-60).reverse();
  return (
    <ol className={cx('space-y-2 overflow-y-auto pr-1', className)} aria-live="polite" aria-label="What is happening">
      {shown.length === 0 && <li className="rounded-2xl border border-dashed border-fg/15 p-4 text-sm text-stone-500">Nothing yet. Start a run and the news shows up here.</li>}
      {shown.map((e) => {
        const { Icon, tone } = ICON[e.kind] ?? ICON.reject!;
        return (
          <li key={e.id} className="glass-card flex items-start gap-3 rounded-2xl p-3">
            <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-xl', tone)}><Icon size={16} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-stone-800">{e.message}</p>
              <p className="mt-0.5 font-mono text-[10px] text-stone-400">{clock(e.tMs)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
