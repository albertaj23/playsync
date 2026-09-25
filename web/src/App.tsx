import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { Mascot } from './components/Mascot';
import { AppShell } from './components/shell/AppShell';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { recall, remember, restoreScroll } from './lib/scrollMemory';
import HomePage from './pages/HomePage';
import DevicesPage from './pages/devices/DevicesPage';

const DevicePage = lazy(() => import('./pages/DevicePage'));
const NerdsPage = lazy(() => import('./pages/NerdsPage'));
const StressTestPage = lazy(() => import('./pages/StressTestPage'));
const SimPage = lazy(() => import('./components/sim/SimPage'));

if (typeof history !== 'undefined') history.scrollRestoration = 'manual';

/** Route wrapper: CSS enter animation (ends at transform:none), scroll memory, hash jumps, focus to the heading. */
function Page({ children }: { children: ReactNode }) {
  const { pathname, hash, key } = useLocation();
  const navType = useNavigationType();
  const ref = useRef<HTMLDivElement>(null);
  const nav = useRef({ key, navType, hash });
  nav.current = { key, navType, hash };
  // Runs per page (pathname), not per hash: hash changes inside a story are handled by <Story>.
  useLayoutEffect(() => {
    const { key: k, navType: t, hash: h } = nav.current;
    const saved = t === 'POP' ? recall(k) : null;
    if (saved !== null) restoreScroll(saved);
    else if (h) requestAnimationFrame(() => document.getElementById(h.slice(1))?.scrollIntoView());
    else window.scrollTo(0, 0);
    return () => remember(k, window.scrollY);
  }, [pathname]);
  useEffect(() => {
    const h1 = ref.current?.querySelector('h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }, [pathname]);
  return <div ref={ref} key={pathname} className="page-content route-enter">{children}</div>;
}

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <AppShell>
            <Suspense fallback={<div className="grid place-items-center py-20"><Mascot mood="sleepy" size={90} /></div>}>
              <Routes>
                <Route path="/" element={<Page><HomePage /></Page>} />
                <Route path="/devices" element={<Page><DevicesPage /></Page>} />
                <Route path="/device" element={<Page><DevicePage /></Page>} />
                <Route path="/stress" element={<Page><StressTestPage /></Page>} />
                <Route path="/sim" element={<Page><SimPage /></Page>} />
                <Route path="/nerds" element={<Page><NerdsPage /></Page>} />
                <Route path="/playground" element={<Navigate to="/devices" replace />} />
                <Route path="/wall" element={<Navigate to="/devices" replace />} />
                <Route path="/race" element={<Navigate to="/stress" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppShell>
        </ToastProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
