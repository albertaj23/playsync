import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { FlaskConical, Headphones, Home, Moon, Sun, Zap } from 'lucide-react';
import { cx } from './components/ui';
import { Mascot } from './components/Mascot';
import { Dock } from './components/watermelon/dock';
import { FluidTabs } from './components/watermelon/fluid-tabs';
import { CommandSearch, type CommandItem } from './components/watermelon/command-search';
import { ThemeProvider, useTheme } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { enterUp } from './lib/motion';
import HomePage from './pages/HomePage';
import DevicesPage from './pages/DevicesPage';

const DevicePage = lazy(() => import('./pages/DevicePage'));
const NerdsPage = lazy(() => import('./pages/NerdsPage'));
const StressTestPage = lazy(() => import('./pages/StressTestPage'));

const NAV = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/devices', label: 'My devices', Icon: Headphones },
  { to: '/stress', label: 'Stress test', Icon: Zap },
  { to: '/nerds', label: 'Nerds', Icon: FlaskConical },
];

function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => { enterUp('.page-content', { step: 0 }); window.scrollTo({ top: 0 }); }, [pathname]);
  return <div className="page-content">{children}</div>;
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-fg/6 text-stone-600 ring-1 ring-fg/10 transition-all hover:bg-fg/10 hover:text-stone-900 active:scale-90"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const activeTo = NAV.find((n) => n.to !== '/' && pathname.startsWith(n.to))?.to ?? (pathname === '/' ? '/' : '/devices');
  const go = (to: string) => () => navigate(to);
  const items: CommandItem[] = [
    { id: 'home', title: 'Home', section: 'Go to', icon: <Home size={16} />, action: go('/') },
    { id: 'devices', title: 'My devices', section: 'Go to', icon: <Headphones size={16} />, action: go('/devices') },
    { id: 'stress', title: 'Stress test', section: 'Go to', icon: <Zap size={16} />, action: go('/stress') },
    { id: 'nerds', title: 'Stats for nerds', section: 'Go to', icon: <FlaskConical size={16} />, action: go('/nerds') },
    { id: 'stepper', title: 'Transaction Stepper', section: 'Nerd tools', icon: <FlaskConical size={16} />, action: go('/nerds?tab=stepper') },
    { id: 'lab', title: 'Concurrency Lab', section: 'Nerd tools', icon: <FlaskConical size={16} />, action: go('/nerds?tab=lab') },
    { id: 'theme', title: 'Switch light / dark', section: 'Handy', icon: <Sun size={16} />, action: toggle },
  ];

  return (
    <div className="min-h-screen pb-28 sm:pb-0">
      <header className="glass-header sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:gap-5 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <Mascot mood="happy" size={42} />
            <span className="font-display text-xl font-semibold tracking-tight text-stone-900">PlaySync</span>
          </NavLink>
          <div className="hidden min-w-0 flex-1 justify-center sm:flex">
            <FluidTabs
              activeId={activeTo}
              onChange={(id) => navigate(id)}
              tabs={NAV.map((n) => ({ id: n.to, label: n.label, icon: <n.Icon size={18} /> }))}
            />
          </div>
          <div className="ml-auto flex items-center gap-3 sm:ml-0">
            <div className="hidden lg:block"><CommandSearch items={items} placeholder="Jump to…" /></div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Suspense fallback={<div className="grid place-items-center py-20"><Mascot mood="sleepy" size={90} /></div>}>
          <Routes>
            <Route path="/" element={<Page><HomePage /></Page>} />
            <Route path="/devices" element={<Page><DevicesPage /></Page>} />
            <Route path="/device" element={<Page><DevicePage /></Page>} />
            <Route path="/stress" element={<Page><StressTestPage /></Page>} />
            <Route path="/nerds" element={<Page><NerdsPage /></Page>} />
            <Route path="/playground" element={<Navigate to="/devices" replace />} />
            <Route path="/wall" element={<Navigate to="/devices" replace />} />
            <Route path="/race" element={<Navigate to="/stress" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      <nav className={cx('fixed inset-x-0 bottom-3 z-30 flex justify-center px-4 sm:hidden')} aria-label="Main">
        <Dock
          activeId={activeTo}
          onSelect={(id) => navigate(String(id))}
          items={NAV.map((n) => ({ id: n.to, Icon: n.Icon, label: n.label }))}
        />
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
