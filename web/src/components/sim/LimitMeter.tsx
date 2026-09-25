import { cx } from '../ui';

/** "2 / 2 screens" with one pip per allowed screen; extra red pips show screens over the limit. */
export function LimitMeter({ active, max }: { active: number; max: number }) {
  const over = active > max;
  const pips = Math.max(active, max);
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap gap-1" aria-hidden>
        {Array.from({ length: Math.min(pips, 24) }, (_, i) => (
          <span key={i} className={cx('h-2.5 w-2.5 rounded-full', i >= max ? 'bg-rose-500' : i < active ? 'bg-emerald-500' : 'bg-fg/15')} />
        ))}
        {pips > 24 && <span className="text-[10px] text-rose-400">+{pips - 24}</span>}
      </div>
      <span className={cx('text-sm font-semibold tabular-nums', over ? 'text-rose-400' : 'text-stone-700')}>
        {active} / {max} screens
      </span>
    </div>
  );
}
