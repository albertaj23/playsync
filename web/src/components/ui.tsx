import React, { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { countUp } from '../lib/motion';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ─── Card ───────────────────────────────────────────────────────────────── */
export const Card = React.forwardRef<HTMLElement, {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
}>(({ children, className, title, subtitle, action, padded = true }, ref) => (
  <section
    ref={ref}
    className={cx('glass-card rounded-3xl overflow-hidden', className)}
  >
    {(title || action) && (
      <header className="flex items-start justify-between gap-4 border-b border-fg/6 px-5 py-4">
        <div>
          <h2 className="font-semibold text-stone-900 tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
        </div>
        {action}
      </header>
    )}
    <div className={padded ? 'p-5' : ''}>{children}</div>
  </section>
));
Card.displayName = 'Card';

/* ─── Badge ──────────────────────────────────────────────────────────────── */
const tones = {
  stone: 'bg-fg/6 text-stone-500 ring-fg/10',
  green: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25',
  amber: 'bg-amber-500/10 text-amber-400 ring-amber-500/25',
  red:   'bg-rose-500/10   text-rose-400   ring-rose-500/25',
  violet:'bg-violet-500/10 text-violet-400 ring-violet-500/25',
  sky:   'bg-sky-500/10    text-sky-400    ring-sky-500/25',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ children, tone = 'stone', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

/* ─── Button ─────────────────────────────────────────────────────────────── */
const variants = {
  primary:   'bg-violet-600 text-[#fff] shadow-sm shadow-violet-900/40 hover:bg-violet-500 disabled:opacity-50',
  play:      'bg-emerald-600 text-[#fff] shadow-sm shadow-emerald-900/40 hover:bg-emerald-500 disabled:opacity-50',
  secondary: 'bg-fg/6 text-stone-800 ring-1 ring-inset ring-fg/10 hover:bg-fg/10 disabled:opacity-40',
  danger:    'bg-rose-500/10 text-rose-400 ring-1 ring-inset ring-rose-500/25 hover:bg-rose-500/20 disabled:opacity-40',
  ghost:     'text-stone-500 hover:bg-fg/6 hover:text-stone-800 disabled:opacity-40',
} as const;

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants; size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-2xl font-semibold transition-all duration-200 active:scale-[0.96] hover:-translate-y-px disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500',
        sizes[size],
        variants[variant],
        className,
      )}
    />
  );
}

/* ─── Dot ────────────────────────────────────────────────────────────────── */
export function Dot({ tone }: { tone: 'green' | 'amber' | 'red' | 'stone' }) {
  const color = {
    green: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]',
    amber: 'bg-amber-400  shadow-[0_0_6px_rgba(251,191,36,0.6)]',
    red:   'bg-rose-400   shadow-[0_0_6px_rgba(251,113,133,0.6)]',
    stone: 'bg-stone-400',
  }[tone];
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', color)} />;
}

/* ─── Equalizer ──────────────────────────────────────────────────────────── */
export function Equalizer({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex h-3.5 items-end gap-0.5', className)} aria-hidden>
      <span className="eq-bar h-full w-1 rounded-sm bg-current" />
      <span className="eq-bar h-full w-1 rounded-sm bg-current" />
      <span className="eq-bar h-full w-1 rounded-sm bg-current" />
    </span>
  );
}

/** A number that counts up to its value, always ending on the exact figure. */
export function CountNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { countUp(ref.current, value); }, [value]);
  return <span ref={ref}>{value}</span>;
}

/* ─── Stat ───────────────────────────────────────────────────────────────── */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-400' : tone === 'red' ? 'text-rose-400' : tone === 'amber' ? 'text-amber-400' : 'text-stone-900';
  return (
    <div className="glass-card rounded-xl px-4 py-3">
      <div className="label-caps">{label}</div>
      <div className={cx('mt-0.5 text-xl font-semibold tabular-nums tracking-tight', color)}>{typeof value === 'number' ? <CountNumber value={value} /> : value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-400">{hint}</div>}
    </div>
  );
}

/* ─── Field ──────────────────────────────────────────────────────────────── */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

/* ─── Input class ────────────────────────────────────────────────────────── */
export const inputCls =
  'w-full rounded-xl border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 disabled:bg-fg/3 disabled:text-stone-400 transition-colors';

/* ─── Code ───────────────────────────────────────────────────────────────── */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-stone-200 px-1.5 py-0.5 font-mono text-[12px] text-stone-700">{children}</code>;
}

/* ─── Segmented ──────────────────────────────────────────────────────────── */
export function Segmented<T extends string | number>({ value, options, onChange, disabled }: {
  value: T; options: { value: T; label: ReactNode; hint?: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-fg/4 p-1 ring-1 ring-fg/8">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed',
            value === o.value
              ? 'bg-fg/12 text-stone-900 shadow-sm'
              : 'text-stone-500 hover:text-stone-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
