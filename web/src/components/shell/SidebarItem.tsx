import { NavLink } from 'react-router-dom';
import { cx } from '../ui';
import { Tooltip } from './Tooltip';
import type { NavItem } from './nav';

export function SidebarItem({ item, collapsed, onNavigate, badge }: { item: NavItem; collapsed: boolean; onNavigate?: () => void; badge?: string }) {
  return (
    <Tooltip label={item.label} enabled={collapsed}>
      <NavLink
        to={item.to} end={item.to === '/'} onClick={onNavigate}
        className={({ isActive }) => cx(
          'group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors',
          collapsed && 'justify-center',
          isActive ? 'bg-violet-500/12 text-violet-400' : 'text-stone-600 hover:bg-fg/6 hover:text-stone-900',
        )}
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-violet-500" aria-hidden />}
            <item.Icon size={20} className="shrink-0" />
            <span className={cx('overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-150', collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100')} aria-hidden={collapsed}>
              {item.label}
            </span>
            {badge && (collapsed
              ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" aria-hidden />
              : <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">{badge}</span>)}
            {collapsed && <span className="sr-only">{item.label}{badge ? `, ${badge}` : ''}</span>}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}
