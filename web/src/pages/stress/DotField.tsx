import { cx } from '../../components/ui';
import type { DotKind } from './experiment';

const COLS = 20;
const STEP = 22;
const CLS: Record<DotKind, string> = { ok: 'bg-emerald-500', over: 'bg-rose-500', busy: 'bg-stone-400', err: 'bg-amber-400', lost: 'bg-rose-500' };
const rnd = (i: number, k: number) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

/**
 * One dot per screen (or listener). While a run is in flight the dots rush around; when the result
 * arrives the SAME dots settle into the grid, coloured by what really happened (data-true: the
 * counts come from the server response). Movement is CSS transitions on left/top only.
 */
export function DotField({ count, dots, running }: { count: number; dots: DotKind[] | null; running: boolean }) {
  const n = Math.max(count, dots?.length ?? 0);
  const rows = Math.ceil((dots?.length ?? count) / COLS);
  const height = running ? 170 : Math.max(rows, 1) * STEP;
  return (
    <div className="relative w-full overflow-hidden transition-[height] duration-700 ease-out" style={{ height }} aria-label={dots ? 'Result of every screen' : 'Screens'} role="img">
      {Array.from({ length: n }, (_, i) => {
        const shown = running || i < (dots?.length ?? count);
        const left = running ? `${2 + rnd(i, 1) * 92}%` : `${(i % COLS) * STEP}px`;
        const top = running ? `${rnd(i, 2) * 150}px` : `${Math.floor(i / COLS) * STEP}px`;
        const kind = !running && dots ? dots[i] : undefined;
        return (
          <span key={i} style={{ left, top, opacity: shown ? 1 : 0, animationDelay: `${(i % 7) * 90}ms` }}
            className={cx('absolute h-4 w-4 rounded-full transition-[left,top,background-color,opacity] duration-700 ease-out',
              kind ? CLS[kind] : 'bg-fg/25', running && 'race-jitter bg-violet-500/70')} />
        );
      })}
    </div>
  );
}
