import { useEffect, useRef } from 'react';
import { FEATURES } from '../../lib/chrome';
import { pop } from '../../lib/motion';
import { ArrowLeft, Menu, Moon, Search, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useSidebar, usePageMetaValue } from '../../lib/shell';
import { useTheme } from '../../lib/theme';
import { itemFor } from './nav';
import { readTopbarPx as readTopbar } from '../../lib/story/useScrollProgress';

/** Slim contextual bar: sidebar toggle, title (page › chapter), search, theme. Nothing else. */
export function TopBar({ focus }: { focus: boolean }) {
  const { pathname } = useLocation();
  const { width, toggle, setSearchOpen } = useSidebar();
  const { theme, toggle: toggleTheme } = useTheme();
  const meta = usePageMetaValue();
  const page = meta.title ?? itemFor(pathname)?.label ?? 'PlaySync';
  const phone = width < 768;
  const line = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!FEATURES.headerMorph) return;
    const root = document.documentElement;
    let io: IntersectionObserver | null = null;
    const t = window.setTimeout(() => {
      const h1 = document.querySelector('main h1');
      if (!h1) { root.dataset.h1 = 'out'; return; }
      io = new IntersectionObserver(([e]) => {
        const out = !e!.isIntersecting;
        if (out && root.dataset.h1 !== 'out') pop(titleRef.current);
        if (out) root.dataset.h1 = 'out'; else delete root.dataset.h1;
      }, { rootMargin: `-${Math.round(readTopbar())}px 0px 0px 0px` });
      io.observe(h1);
    }, 400);
    return () => { window.clearTimeout(t); io?.disconnect(); delete root.dataset.h1; };
  }, [pathname]);
  const progress = meta.progress;
  useEffect(() => {
    const el = line.current;
    if (!el || !progress) return;
    let raf = 0;
    const tick = () => { el.style.transform = `scaleX(${progress.current})`; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress]);
  return (
    <header className="app-topbar glass-header sticky top-0 z-20 h-[var(--topbar-h)]">
      <div className="flex h-full items-center gap-3 px-3 sm:px-5">
        {focus ? (
          <Link to="/devices" aria-label="Back to My devices" className="grid h-9 w-9 place-items-center rounded-xl text-stone-600 hover:bg-fg/8"><ArrowLeft size={19} /></Link>
        ) : phone ? (
          <button onClick={toggle} aria-label="More" className="grid h-9 w-9 place-items-center rounded-xl text-stone-600 hover:bg-fg/8"><Menu size={19} /></button>
        ) : null}
        <div ref={titleRef} className={`topbar-title min-w-0 flex-1 truncate text-sm ${FEATURES.headerMorph ? 'topbar-title--muted' : ''}`}>
          {phone && meta.chapter ? (
            <span className="font-semibold text-stone-900">{meta.chapter}</span>
          ) : (
            <>
              <span className="font-display text-base font-semibold text-stone-900">{page}</span>
              {meta.chapter && <span className="text-stone-500"> › {meta.chapter}</span>}
            </>
          )}
        </div>
        <button onClick={() => setSearchOpen(true)} aria-label="Search"
          className="flex h-9 items-center gap-2 rounded-xl bg-fg/6 px-2.5 text-sm text-stone-500 ring-1 ring-fg/10 transition-colors hover:bg-fg/10 sm:min-w-52 sm:px-3">
          <Search size={16} />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="ml-auto hidden rounded border border-fg/15 px-1.5 text-[10px] font-bold sm:inline">⌘K</kbd>
        </button>
        <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/6 text-stone-600 ring-1 ring-fg/10 transition-all hover:bg-fg/10 active:scale-90">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
      {progress && <div ref={line} className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-violet-500" style={{ transform: 'scaleX(0)' }} aria-hidden />}
    </header>
  );
}
