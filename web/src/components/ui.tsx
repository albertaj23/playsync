import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ children, className, title, action, subtitle }: {
  children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode;
}) {
  return (
    <section className={cx('rounded-xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const tones = {
  zinc: 'bg-zinc-800 text-zinc-300 ring-zinc-700',
  green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  amber: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  red: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  indigo: 'bg-indigo-500/10 text-indigo-300 ring-indigo-500/30',
  sky: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
} as const;
export type Tone = keyof typeof tones;

export function Badge({ children, tone = 'zinc', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

const variants = {
  primary: 'bg-indigo-500 text-white hover:bg-indigo-400 disabled:bg-indigo-500/40',
  secondary: 'bg-zinc-800 text-zinc-200 ring-1 ring-inset ring-zinc-700 hover:bg-zinc-700 disabled:opacity-40',
  danger: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40',
  ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40',
} as const;

export function Button({ variant = 'secondary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      {...rest}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed', variants[variant], className)}
    />
  );
}

export function Dot({ tone, pulse }: { tone: 'green' | 'amber' | 'red' | 'zinc'; pulse?: boolean }) {
  const color = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-rose-400', zinc: 'bg-zinc-600' }[tone];
  return <span className={cx('inline-block h-2 w-2 rounded-full', color, pulse && 'pulse-ring')} />;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-300' : tone === 'red' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-zinc-100';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cx('mt-1 text-xl font-semibold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20';

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[12px] text-zinc-200">{children}</code>;
}
