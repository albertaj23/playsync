import { useEffect, useRef, useState, type RefObject, type MutableRefObject } from 'react';
import { chapterAt, progressFor } from './progress';
import { observe } from './scrollBus';

/** Reads the current sticky offset (the top bar height) from the shared CSS variable. */
export function readTopbarPx(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim();
  if (v.endsWith('rem')) return parseFloat(v) * parseFloat(getComputedStyle(document.documentElement).fontSize);
  return parseFloat(v) || 0;
}

/**
 * Scroll progress (0..1) of a tall scene. Per-frame values live in a ref (for anime timelines);
 * `step` is React state that changes only when a cut is crossed (for captions).
 */
export function useScrollProgress(ref: RefObject<HTMLElement>, cuts: number[] = []): { progress: MutableRefObject<number>; step: number } {
  const progress = useRef(0);
  const [step, setStep] = useState(-1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observe(el, (rect, vh) => {
      const p = progressFor(rect.top, rect.height, vh, readTopbarPx());
      progress.current = p;
      const s = chapterAt(p, cuts);
      setStep((prev) => (prev === s ? prev : s));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return { progress, step };
}
