import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useShortcut } from '../../lib/keys';
import { reduced } from '../../lib/motion';
import { usePageMeta, type PageCommand } from '../../lib/shell';
import { activeChapter } from '../../lib/story/progress';
import { shouldAutoAdvance } from '../../lib/story/autoAdvance';
import { debounce, pushHash, replaceHash } from '../../lib/story/history';
import { onFrame } from '../../lib/story/scrollBus';
import { readTopbarPx } from '../../lib/story/useScrollProgress';
import type { GlyphName } from '../geo/Glyph';
import { AutoAdvanceToast } from './AutoAdvanceToast';

export interface ChapterDef { id: string; title: string; kind: 'scene' | 'work'; glyph: GlyphName }

interface StoryApi {
  chapters: ChapterDef[];
  active: string;
  progress: MutableRefObject<number>;
  goTo: (id: string, opts?: { push?: boolean }) => void;
  next: () => void;
  prev: () => void;
  /** Jump to a result chapter after an action, only if the user hasn't touched the page since `pressedAt`. */
  autoAdvance: (id: string, pressedAt: number, backLabel: string) => boolean;
}
const Ctx = createContext<StoryApi | null>(null);
export const useStory = () => { const c = useContext(Ctx); if (!c) throw new Error('useStory outside <Story>'); return c; };

/** Owns a page's chapters: active-chapter tracking, hash sync, keyboard stepping, programmatic jumps. */
export function Story({ title, chapters, commands, children }: { title: string; chapters: ChapterDef[]; commands?: PageCommand[]; children: ReactNode }) {
  const [active, setActive] = useState(chapters[0]!.id);
  const [toast, setToast] = useState<{ y: number; label: string } | null>(null);
  const location = useLocation();
  const progress = useRef(0);
  const lastInput = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const locRef = useRef(location);
  locRef.current = location;

  const activeTitle = chapters.find((c) => c.id === active)?.title;
  usePageMeta({ title, chapter: activeTitle, progress, commands });

  useEffect(() => {
    const mark = () => { lastInput.current = Date.now(); };
    const evs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  useEffect(() => {
    const writeHash = debounce((id: string) => replaceHash(window.history, locRef.current, id), 300);
    const off = onFrame((vh, y) => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - vh;
      progress.current = max > 0 ? Math.max(0, Math.min(1, y / max)) : 0;
      const tops = chapters.map((c) => ({ id: c.id, top: document.getElementById(c.id)?.getBoundingClientRect().top ?? Infinity }));
      const id = activeChapter(tops, vh, readTopbarPx(), max > 0 && y >= max - 2);
      if (id && id !== activeRef.current) { setActive(id); if (y > 0) writeHash(id); }
    });
    return () => { off(); writeHash.cancel(); };
  }, [chapters]);

  // Back/Forward between hash entries of the same page: follow the hash (top when there is none).
  useEffect(() => {
    const onPop = () => {
      const id = window.location.hash.slice(1);
      const el = id ? document.getElementById(id) : null;
      if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goTo = useCallback((id: string, opts: { push?: boolean } = {}) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (opts.push !== false) pushHash(window.history, locRef.current, id);
    el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    const h = el.querySelector<HTMLElement>('h1, h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }, []);

  const step = useCallback((d: number) => {
    const i = chapters.findIndex((c) => c.id === activeRef.current);
    const t = chapters[Math.max(0, Math.min(chapters.length - 1, i + d))];
    if (t) goTo(t.id);
  }, [chapters, goTo]);
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  useShortcut('alt+arrowdown', next);
  useShortcut('alt+arrowup', prev);

  const autoAdvance = useCallback((id: string, pressedAt: number, backLabel: string) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    const ratio = r.height > 0 ? visible / Math.min(r.height, window.innerHeight) : 0;
    if (!shouldAutoAdvance({ pressedAt, lastUserInputAt: lastInput.current, resultAt: Date.now(), targetVisibleRatio: ratio })) return false;
    setToast({ y: window.scrollY, label: backLabel });
    goTo(id, { push: false });
    return true;
  }, [goTo]);

  const api = useMemo<StoryApi>(() => ({ chapters, active, progress, goTo, next, prev, autoAdvance }), [chapters, active, goTo, next, prev, autoAdvance]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <AutoAdvanceToast toast={toast} onDone={() => setToast(null)} />
    </Ctx.Provider>
  );
}
