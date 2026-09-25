export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Local progress (0..1) through a tall scene chapter whose stage sticks `offsetTop` px from the
 * viewport top. `rectTop`/`rectHeight` are the chapter's bounding box. A scene no taller than the
 * viewport has nothing to scrub: it reads 1 once it reaches the sticky line, else 0.
 */
export function progressFor(rectTop: number, rectHeight: number, viewportH: number, offsetTop: number): number {
  const total = rectHeight - (viewportH - offsetTop);
  if (total <= 0) return rectTop <= offsetTop ? 1 : 0;
  return clamp01(-(rectTop - offsetTop) / total);
}

/** Index of the last cut that `p` has reached, or -1 before the first cut. */
export function chapterAt(p: number, cuts: number[]): number {
  let idx = -1;
  for (let i = 0; i < cuts.length; i++) if (p >= cuts[i]!) idx = i;
  return idx;
}

/**
 * The chapter that counts as "current": the last one whose top has crossed 40% of the visible
 * area below the sticky bar. At the very bottom of the page it is always the last chapter.
 */
export function activeChapter(tops: { id: string; top: number }[], viewportH: number, offsetTop: number, atBottom = false): string | null {
  if (tops.length === 0) return null;
  if (atBottom) return tops[tops.length - 1]!.id;
  const line = offsetTop + 0.4 * (viewportH - offsetTop);
  let active = tops[0]!.id;
  for (const t of tops) if (t.top <= line) active = t.id;
  return active;
}
