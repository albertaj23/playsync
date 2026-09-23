import { NavLink, Route, Routes } from 'react-router-dom';
import OverviewPage from './pages/OverviewPage';
import PlaygroundPage from './pages/PlaygroundPage';
import RacePage from './pages/RacePage';
import { cx } from './components/ui';

const nav = [
  { to: '/', label: 'Overview' },
  { to: '/playground', label: 'Playground' },
  { to: '/race', label: 'Race lab' },
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:gap-8 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-400 to-emerald-400 text-xs font-bold text-zinc-950">PS</div>
            <span className="hidden font-semibold tracking-tight text-zinc-100 sm:inline">PlaySync</span>
          </div>
          <nav className="flex min-w-0 gap-1 overflow-x-auto">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end
                className={({ isActive }) => cx(
                  'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
                )}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/race" element={<RacePage />} />
        </Routes>
      </main>
    </div>
  );
}
