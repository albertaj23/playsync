const KEY = 'playsync-scroll';

function load(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
export function remember(key: string, y: number): void {
  try { const m = load(); m[key] = Math.round(y); sessionStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage blocked */ }
}
export function recall(key: string): number | null {
  const y = load()[key];
  return typeof y === 'number' ? y : null;
}

/** Scrolls to y, retrying for up to ~1 s because lazy routes may not have their full height yet. */
export function restoreScroll(y: number, maxFrames = 60): void {
  let frames = 0;
  const step = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 2 && frames++ < maxFrames) requestAnimationFrame(step);
  };
  step();
}
