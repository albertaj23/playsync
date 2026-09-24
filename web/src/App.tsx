import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { cx } from './components/ui';
import DevicesPage from './pages/DevicesPage';
import DevicePage from './pages/DevicePage';
import HomePage from './pages/HomePage';
import NerdsPage from './pages/NerdsPage';
import StressTestPage from './pages/StressTestPage';

const nav = [
  { to: '/', label: 'Home' },
  { to: '/devices', label: 'My devices' },
  { to: '/stress', label: 'Stress test' },
];

const linkCls = ({ isActive }: { isActive: boolean }) => cx(
  'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
  isActive ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
);

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 text-sm font-bold text-white">♪</div>
            <span className="hidden font-semibold tracking-tight text-stone-900 sm:inline">PlaySync</span>
          </NavLink>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {nav.map((n) => <NavLink key={n.to} to={n.to} end className={linkCls}>{n.label}</NavLink>)}
          </nav>
          <NavLink
            to="/nerds"
            className={({ isActive }) => cx(
              'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-xs font-medium ring-1 ring-inset transition-colors',
              isActive ? 'bg-stone-900 text-emerald-300 ring-stone-900' : 'text-stone-600 ring-stone-300 hover:bg-stone-100',
            )}
          >
            {'</>'}<span className="hidden sm:inline"> Stats for nerds</span>
          </NavLink>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/device" element={<DevicePage />} />
          <Route path="/stress" element={<StressTestPage />} />
          <Route path="/nerds" element={<NerdsPage />} />
          {/* Old addresses from earlier builds */}
          <Route path="/playground" element={<Navigate to="/devices" replace />} />
          <Route path="/wall" element={<Navigate to="/devices" replace />} />
          <Route path="/race" element={<Navigate to="/stress" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
