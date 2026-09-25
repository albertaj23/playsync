import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useSidebar } from '../../lib/shell';
import { cx } from '../ui';
import { NAV_GROUPS } from './nav';

const TABS = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.to !== '/nerds');

/** Phone navigation: labelled bottom tabs; "More" opens the sheet with Nerds, phone link, theme. */
export function TabBar() {
  const { width, focus, moreOpen, setMoreOpen } = useSidebar();
  if (width >= 768 || focus) return null;
  return (
    <nav aria-label="Main (mobile)" className="app-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-fg/10 bg-[var(--surface)]/95 pb-[var(--safe-bottom)] backdrop-blur-xl">
      <ul className="flex h-16 items-stretch justify-around px-1">
        {TABS.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink to={t.to} end={t.to === '/'} onClick={() => setMoreOpen(false)}
              className={({ isActive }) => cx('flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors', isActive ? 'text-violet-400' : 'text-stone-500')}>
              <t.Icon size={21} />
              {t.short}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <button onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}
            className={cx('flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', moreOpen ? 'text-violet-400' : 'text-stone-500')}>
            <Ellipsis size={21} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
