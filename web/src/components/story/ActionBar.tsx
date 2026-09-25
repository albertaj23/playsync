import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStory } from './Story';

/**
 * A floating bar for a page's primary actions, shown while one of `chapters` is active (or always
 * when omitted). Sits above the phone tab bar and centres in the content column on desktop.
 */
export function ActionBar({ chapters, children }: { chapters?: string[]; children: ReactNode }) {
  const { active } = useStory();
  if (chapters && !chapters.includes(active)) return null;
  return createPortal(
    <div className="action-bar pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+14px)] z-30 flex justify-center px-4 md:pl-[var(--sidebar-w)]">
      <div role="toolbar" aria-label="Page actions" className="reveal surface pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-3xl border border-fg/10 p-2 shadow-xl">
        {children}
      </div>
    </div>,
    document.body,
  );
}
