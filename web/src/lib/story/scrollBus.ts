// One passive scroll/resize listener and one rAF for the whole app. Scenes subscribe with their
// element; the bus measures only elements near the viewport (IntersectionObserver) and calls back
// with the bounding rect. Nothing here re-renders React.

type RectCb = (rect: DOMRect, viewportH: number) => void;
type FrameCb = (viewportH: number, scrollY: number) => void;

interface Sub { el: Element; cb: RectCb; visible: boolean }

const subs = new Set<Sub>();
const frames = new Set<FrameCb>();
let raf = 0;
let io: IntersectionObserver | null = null;
let attached = false;

function run() {
  raf = 0;
  const vh = window.innerHeight;
  for (const s of subs) if (s.visible) s.cb(s.el.getBoundingClientRect(), vh);
  for (const f of frames) f(vh, window.scrollY);
}
const schedule = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(run); };

function attach() {
  if (attached) return;
  attached = true;
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  io = new IntersectionObserver((entries) => {
    for (const e of entries) for (const s of subs) if (s.el === e.target) s.visible = e.isIntersecting;
    schedule();
  }, { rootMargin: '100% 0px 100% 0px' });
}
function detachIfIdle() {
  if (subs.size || frames.size || !attached) return;
  attached = false;
  window.removeEventListener('scroll', schedule);
  window.removeEventListener('resize', schedule);
  io?.disconnect(); io = null;
  cancelAnimationFrame(raf); raf = 0;
}

/** Calls `cb` (every frame while near the viewport) with the element's rect. Returns unsubscribe. */
export function observe(el: Element, cb: RectCb): () => void {
  attach();
  const s: Sub = { el, cb, visible: true };
  subs.add(s);
  io!.observe(el);
  schedule();
  return () => { subs.delete(s); io?.unobserve(el); detachIfIdle(); };
}

/** Calls `cb` once per scroll frame regardless of visibility (page-level work). */
export function onFrame(cb: FrameCb): () => void {
  attach();
  frames.add(cb);
  schedule();
  return () => { frames.delete(cb); detachIfIdle(); };
}

/** Number of scene subscribers currently measured (debug/verification). */
export const activeCount = () => [...subs].filter((s) => s.visible).length;
