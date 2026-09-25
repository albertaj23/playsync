import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SidebarPref = 'expanded' | 'rail';
export type SidebarMode = 'expanded' | 'rail' | 'hidden';
const KEY = 'playsync-sidebar';

export function readPref(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SidebarPref {
  try { return storage?.getItem(KEY) === 'rail' ? 'rail' : 'expanded'; } catch { return 'expanded'; }
}
function safeStorage(): Storage | null { try { return localStorage; } catch { return null; } }

/** The persisted preference only applies on desktop; tablets get a rail, phones no sidebar. */
export function modeFor(width: number, pref: SidebarPref, focus: boolean, forceRail = false): SidebarMode {
  if (focus || width < 768) return 'hidden';
  if (width < 1280 || forceRail) return 'rail';
  return pref;
}

interface Ctx {
  mode: SidebarMode; focus: boolean; width: number; overlayOpen: boolean; moreOpen: boolean; searchOpen: boolean;
  setForceRail: (v: boolean) => void;
  toggle: () => void; setOverlayOpen: (v: boolean) => void; setMoreOpen: (v: boolean) => void; setSearchOpen: (v: boolean) => void;
}
const SidebarCtx = createContext<Ctx | null>(null);

export function SidebarProvider({ focus, children }: { focus: boolean; children: ReactNode }) {
  const [pref, setPref] = useState<SidebarPref>(() => readPref());
  const [width, setWidth] = useState(() => window.innerWidth);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [forceRail, setForceRail] = useState(false);
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const mode = modeFor(width, pref, focus, forceRail);
  useEffect(() => {
    document.documentElement.dataset.sidebar = mode;
    if (focus) document.documentElement.dataset.focus = ''; else delete document.documentElement.dataset.focus;
  }, [mode, focus]);
  useEffect(() => { if (mode !== 'rail') setOverlayOpen(false); }, [mode]);

  const toggle = useCallback(() => {
    if (width < 768) setMoreOpen((v) => !v);
    else if (width < 1280) setOverlayOpen((v) => !v);
    else setPref((p) => {
      const next: SidebarPref = p === 'expanded' ? 'rail' : 'expanded';
      try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
      return next;
    });
  }, [width]);

  const value = useMemo(() => ({ mode, focus, width, overlayOpen, moreOpen, searchOpen, setForceRail, toggle, setOverlayOpen, setMoreOpen, setSearchOpen }),
    [mode, focus, width, overlayOpen, moreOpen, searchOpen, toggle]);
  return <SidebarCtx.Provider value={value}>{children}</SidebarCtx.Provider>;
}

export function useSidebar(): Ctx {
  const c = useContext(SidebarCtx);
  if (!c) throw new Error('useSidebar outside SidebarProvider');
  return c;
}

// ------------------------------------------------------------------ page metadata

export interface PageCommand { id: string; title: string; action: () => void }
export interface PageMeta { title?: string; chapter?: string; commands?: PageCommand[]; progress?: { current: number } }
const MetaCtx = createContext<{ meta: PageMeta; setMeta: (m: PageMeta) => void }>({ meta: {}, setMeta: () => undefined });

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({});
  const value = useMemo(() => ({ meta, setMeta }), [meta]);
  return <MetaCtx.Provider value={value}>{children}</MetaCtx.Provider>;
}
export const usePageMetaValue = () => useContext(MetaCtx).meta;

/** A page declares what the shell shows (title, current chapter, palette commands). */
export function usePageMeta(meta: PageMeta) {
  const { setMeta } = useContext(MetaCtx);
  const { title, chapter, progress } = meta;
  useEffect(() => { setMeta({ title, chapter, commands: meta.commands, progress }); return () => setMeta({}); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, chapter, progress, meta.commands, setMeta]);
}
