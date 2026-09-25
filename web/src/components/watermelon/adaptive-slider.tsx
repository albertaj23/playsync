// Vendored from https://registry.watermelon.sh/r/adaptive-slider.json (2026-09-24), then restyled for PlaySync:
// no card/calories chrome, controlled label + unit row, neon gradient that shifts cyan -> violet -> coral with
// the value, glowing orb thumb, tick marks, theme tokens (light + dark). Native <input type="range"> kept on
// top (invisible) so keyboard, touch and screen readers work.
import { useId, useMemo, type ChangeEvent, type FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface AdaptiveSliderProps {
  label?: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

const STOPS: [number, number, number][] = [[34, 211, 238], [139, 92, 246], [255, 92, 122]]; // cyan, violet, coral

/** Colour at position p (0..1) along the cyan -> violet -> coral ramp. */
export function colorAt(p: number): string {
  const t = Math.max(0, Math.min(1, p)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const [a, b] = [STOPS[i]!, STOPS[i + 1]!];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * f)).join(',')})`;
}

const THUMB = 44;

export const AdaptiveSlider: FC<AdaptiveSliderProps> = ({ label, hint, value, min, max, step = 1, unit = '', disabled, onChange }) => {
  const id = useId();
  const p = max === min ? 0 : (value - min) / (max - min);
  const color = useMemo(() => colorAt(p), [p]);
  const start = useMemo(() => colorAt(Math.max(0, p - 0.45)), [p]);
  const ticks = useMemo(() => Array.from({ length: 9 }, (_, i) => i), []);
  const offset = `calc(${p} * (100% - ${THUMB}px))`;

  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        {label && <label htmlFor={id} className="text-sm font-medium text-stone-700">{label}</label>}
        <span className="flex items-baseline gap-1 font-mono text-lg font-bold tabular-nums" style={{ color }}>
          <AnimatedDigits value={String(value)} />
          {unit && <span className="text-xs font-semibold opacity-80">{unit.trim()}</span>}
        </span>
      </div>

      <div className="relative flex h-11 select-none items-center overflow-hidden rounded-full bg-fg/8 shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)] ring-1 ring-fg/10 transition-shadow focus-within:ring-2 focus-within:ring-violet-500/60">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-6" aria-hidden>
          {ticks.map((i) => <span key={i} className="h-1 w-1 rounded-full bg-fg/25" />)}
        </div>

        <motion.div
          className="pointer-events-none absolute left-0 top-0 h-full rounded-full"
          animate={{ width: `calc(${p} * (100% - ${THUMB}px) + ${THUMB}px)`, background: `linear-gradient(90deg, ${start}, ${color})`, boxShadow: `0 0 22px -4px ${color}` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />

        <input
          id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={label ? undefined : 'value'} aria-valuetext={`${value}${unit}`}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
          className="absolute inset-0 z-50 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />

        <motion.div
          className="pointer-events-none absolute top-0 z-40 grid place-items-center"
          style={{ width: THUMB, height: THUMB - 0 }}
          animate={{ left: offset }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <motion.div
            className="grid size-9 place-items-center rounded-full bg-white"
            animate={{ boxShadow: `0 0 0 2px ${color}, 0 0 18px 2px ${color}` }}
            transition={{ duration: 0.2 }}
          >
            <span className="size-2 rounded-full" style={{ background: color }} />
          </motion.div>
        </motion.div>
      </div>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
};

const AnimatedDigits = ({ value }: { value: string }) => (
  <span className="flex will-change-transform">
    <AnimatePresence mode="popLayout" initial={false}>
      {value.split('').map((ch, i) => (
        <motion.span
          key={ch + i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 20 } }}
          exit={{ opacity: 0, transition: { duration: 0 } }}
        >
          {ch}
        </motion.span>
      ))}
    </AnimatePresence>
  </span>
);
