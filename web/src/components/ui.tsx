import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ children, className, title, subtitle, action, padded = true }: {
  children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; padded?: boolean;
}) {
  return (
    <section className={cx('rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-200/50', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-stone-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

const tones = {
  stone: 'bg-stone-100 text-stone-600 ring-stone-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ children, tone = 'stone', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

const variants = {
  primary: 'bg-violet-600 text-white shadow-sm hover:bg-violet-500 disabled:bg-violet-300',
  play: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 disabled:bg-emerald-300',
  secondary: 'bg-white text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 disabled:opacity-50',
  danger: 'bg-white text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:opacity-50',
  ghost: 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50',
} as const;

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants; size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  return (
    <button
      {...rest}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed', sizes[size], variants[variant], className)}
    />
  );
}

export function Dot({ tone }: { tone: 'green' | 'amber' | 'red' | 'stone' }) {
  const color = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', stone: 'bg-stone-300' }[tone];
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', color)} />;
}

/** Animated equalizer bars shown while music is playing. */
export function Equalizer({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex h-3.5 items-end gap-0.5', className)} aria-hidden>
      <span className="eq-bar h-full w-1 rounded-sm bg-current" />
      <span className="eq-bar h-full w-1 rounded-sm bg-current" />
      <span className="eq-bar h-full w-1 rounded-sm bg-current" />
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-stone-900';
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={cx('mt-0.5 text-xl font-semibold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:bg-stone-50';

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[12px] text-stone-700">{children}</code>;
}

/** Segmented control for a small set of choices. */
export function Segmented<T extends string | number>({ value, options, onChange, disabled }: {
  value: T; options: { value: T; label: ReactNode; hint?: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
            value === o.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
