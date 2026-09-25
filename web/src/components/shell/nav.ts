import { FlaskConical, Headphones, Home, Radio, Zap, type LucideIcon } from 'lucide-react';

export interface NavItem { to: string; label: string; short: string; Icon: LucideIcon }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Listen', items: [
    { to: '/', label: 'Home', short: 'Home', Icon: Home },
    { to: '/devices', label: 'My devices', short: 'Devices', Icon: Headphones },
  ] },
  { label: 'Experiment', items: [
    { to: '/stress', label: 'Stress test', short: 'Stress', Icon: Zap },
    { to: '/sim', label: 'Simulation', short: 'Simulation', Icon: Radio },
  ] },
  { label: 'Under the hood', items: [
    { to: '/nerds', label: 'Stats for nerds', short: 'Nerds', Icon: FlaskConical },
  ] },
];

export const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function itemFor(pathname: string): NavItem | undefined {
  return ALL_ITEMS.find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)));
}
