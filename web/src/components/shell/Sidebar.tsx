import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { api, type Health } from '../../lib/api';
import { useSidebar } from '../../lib/shell';
import { Mascot } from '../Mascot';
import { Dot, cx } from '../ui';
import { NAV_GROUPS } from './nav';
import { PhoneButton } from './PhonePopover';
import { SidebarItem } from './SidebarItem';

function DbStatus({ collapsed }: { collapsed: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const load = () => api.get<Health>('/health').then((r) => setHealth(r.body)).catch(() => setHealth({ ok: false }));
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, []);
  const text = health === null ? 'Warming up the speakers…' : health.ok ? 'Speakers are warm' : "Can't reach the database";
  return (
    <div className={cx('flex items-center gap-2 px-3 py-2 text-xs text-stone-500', collapsed && 'justify-center')} title={text}>
      <Dot tone={health === null ? 'stone' : health.ok ? 'green' : 'red'} />
      {!collapsed ? <span>{text}</span> : <span className="sr-only">{text}</span>}
    </div>
  );
}

/** "live" while a simulation run is in progress (polled lightly; hidden tabs skip). */
function useSimLive(): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const load = () => { if (!document.hidden) api.get<{ phase: string }>('/lab/sim/state').then((r) => setLive(r.ok && (r.body.phase === 'RUNNING' || r.body.phase === 'PAUSED'))).catch(() => undefined); };
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);
  return live;
}

/** Desktop/tablet app navigation. Expanded (248), rail (72) or, on tablets, an overlay opened over the rail. */
export function Sidebar() {
  const { mode, overlayOpen, setOverlayOpen, toggle } = useSidebar();
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverlayOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen, setOverlayOpen]);
  const simLive = useSimLive();
  if (mode === 'hidden') return null;
  const expanded = mode === 'expanded' || overlayOpen;
  const collapsed = !expanded;
  return (
    <>
      {overlayOpen && <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px]" onClick={() => setOverlayOpen(false)} aria-hidden />}
      <aside
        className={cx('app-sidebar glass-header fixed inset-y-0 left-0 z-40 flex flex-col border-r border-fg/8 transition-[width] duration-200 ease-out',
          overlayOpen ? 'w-[248px] shadow-2xl' : 'w-[var(--sidebar-w)]')}
      >
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
          <div className={cx('flex h-[var(--topbar-h)] shrink-0 items-center gap-2 px-3', collapsed ? 'justify-center' : 'justify-between')}>
            {!collapsed && (
              <NavLink to="/" className="flex items-center gap-2">
                <Mascot mood="happy" size={38} />
                <span className="font-display text-xl font-semibold tracking-tight text-stone-900">PlaySync</span>
              </NavLink>
            )}
            <button onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={expanded}
              className="grid h-9 w-9 place-items-center rounded-xl text-stone-500 transition-colors hover:bg-fg/8 hover:text-stone-900 active:scale-90">
              {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3 pt-1">
            {NAV_GROUPS.map((g) => (
              <div key={g.label}>
                {collapsed ? <div className="mx-3 mb-1.5 h-px bg-fg/10" aria-hidden /> : <div className="label-caps mb-1.5 px-3">{g.label}</div>}
                <ul className="space-y-1">
                  {g.items.map((item) => <li key={item.to}><SidebarItem item={item} collapsed={collapsed} badge={item.to === '/sim' && simLive ? 'live' : undefined} onNavigate={() => setOverlayOpen(false)} /></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-fg/8 p-2">
            <PhoneButton collapsed={collapsed} />
            <DbStatus collapsed={collapsed} />
          </div>
        </nav>
      </aside>
    </>
  );
}
