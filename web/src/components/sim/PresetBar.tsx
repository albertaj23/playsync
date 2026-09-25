import { useState } from 'react';
import { Bug, Flame, Hourglass, PanelLeftClose, PanelLeftOpen, Rocket, Users, WifiOff } from 'lucide-react';
import type { Preset } from '../../lib/sim';
import { cx } from '../ui';

const ICONS: Record<string, typeof Flame> = {
  'break-it': Flame, 'family-fight': Users, 'release-night': Rocket, 'flaky-wifi': WifiOff, crash: Bug, 'strict-slow': Hourglass,
};
const KEY = 'playsync-sim-sidebar';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

interface Props { presets: Preset[]; activeId: string | null; onPick: (p: Preset) => void; disabled: boolean }

/** Scenarios: a collapsible sidebar on large screens (icon rail when collapsed), a chip strip on small ones. */
export function PresetBar({ presets, activeId, onPick, disabled }: Props) {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden" role="tablist" aria-label="Scenarios">
        {presets.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} disabled={disabled} title={p.story}
            className={cx('shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50',
              activeId === p.id ? 'border-violet-500 bg-violet-500/15 text-violet-400' : 'glass-card border-transparent text-stone-700')}>
            {p.label}
          </button>
        ))}
      </div>

      <aside className={cx('hidden shrink-0 transition-[width] duration-300 ease-out lg:block', collapsed ? 'w-14' : 'w-60')} aria-label="Scenarios">
        <div className="glass-card sticky top-20 overflow-hidden rounded-3xl p-2">
          <button onClick={toggle} aria-label={collapsed ? 'Expand scenarios' : 'Collapse scenarios'}
            className="mb-1 flex w-full items-center gap-2 rounded-2xl px-2.5 py-2 text-xs font-semibold uppercase tracking-wider text-stone-500 hover:bg-fg/6">
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>Scenarios</span>}
          </button>
          <ul className="space-y-1">
            {presets.map((p) => {
              const Icon = ICONS[p.id] ?? Flame;
              const active = activeId === p.id;
              return (
                <li key={p.id}>
                  <button onClick={() => onPick(p)} disabled={disabled} title={collapsed ? `${p.label}: ${p.story}` : undefined}
                    className={cx('flex w-full items-start gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors disabled:opacity-50',
                      active ? 'bg-violet-500/12 text-violet-400 ring-1 ring-violet-500/30' : 'text-stone-700 hover:bg-fg/6')}>
                    <Icon size={18} className="mt-0.5 shrink-0" />
                    {!collapsed && (
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{p.label}</span>
                        {active && <span className="mt-0.5 block text-xs leading-snug text-stone-500">{p.story}</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </>
  );
}
