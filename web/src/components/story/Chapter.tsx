import type { ReactNode } from 'react';
import { cx } from '../ui';

/**
 * A chapter section: anchor id (URL hash), landmark label, scroll offset under the top bar.
 * Work chapters get a title; scene chapters bring their own headline inside the stage.
 * `gated` chapters show a friendly placeholder until unlocked.
 */
export function Chapter({ id, kind, title, question, gated, placeholder, className, children }: {
  id: string; kind: 'scene' | 'work'; title?: string; question?: string; gated?: boolean; placeholder?: string; className?: string; children: ReactNode;
}) {
  return (
    <section id={id} data-chapter data-kind={kind} aria-labelledby={title ? `${id}-h` : undefined}
      className={cx('scroll-mt-[var(--topbar-h)]', kind === 'work' && 'min-h-[60svh] py-10', className)}>
      {kind === 'work' && title && (
        <header className="mb-5">
          <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{title}</h2>
          {question && <p className="mt-1 text-stone-500">{question}</p>}
        </header>
      )}
      {gated ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-fg/20 px-6 py-16 text-center text-stone-500">{placeholder ?? 'Complete the step above to unlock this.'}</div>
      ) : children}
    </section>
  );
}
