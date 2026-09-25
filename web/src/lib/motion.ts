// Named anime.js v4 presets so pages don't hand-tune numbers. Every preset is a no-op (final
// state, no movement) under prefers-reduced-motion. Rule: anime.js owns anything we author;
// `motion` is used only inside the vendored Watermelon components. Never animate one element
// with both.
import { animate, stagger, splitText, utils } from 'animejs';

export const reduced = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Target = string | Element | Element[] | NodeListOf<Element> | null | undefined;
const ok = (t: Target): t is NonNullable<Target> =>
  !!t && !(typeof t !== 'string' && 'length' in t && t.length === 0);

/** Staggered rise-in. Content is visible by CSS default, so a paused animation never hides it. */
export function enterUp(targets: Target, opts: { delay?: number; step?: number } = {}) {
  if (reduced() || !ok(targets)) return;
  animate(targets as Element, {
    opacity: [0, 1], translateY: [22, 0], duration: 480, ease: 'outCubic',
    delay: stagger(opts.step ?? 70, { start: opts.delay ?? 0 }),
  });
}

export function pop(target: Target) {
  if (reduced() || !ok(target)) return;
  animate(target as Element, { scale: [0.86, 1.08, 1], duration: 520, ease: 'outBack' });
}

export function shake(target: Target) {
  if (reduced() || !ok(target)) return;
  animate(target as Element, { translateX: [0, -7, 7, -5, 5, 0], duration: 380, ease: 'inOutSine' });
}

/** Counts a number up from its current displayed value; always ends on the exact target. */
export function countUp(el: HTMLElement | null, to: number, format: (n: number) => string = (n) => String(Math.round(n))) {
  if (!el) return;
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  if (reduced() || from === to) { el.textContent = format(to); return; }
  const state = { n: from };
  animate(state, {
    n: to, duration: 700, ease: 'outExpo',
    onUpdate: () => { el.textContent = format(state.n); },
    onComplete: () => { el.textContent = format(to); },
  });
}

const CONFETTI = ['#ff5c7a', '#34d399', '#fbbf24', '#38bdf8', '#a78bfa'];

/** Tiny particle burst from `origin`, removed when done. */
export function celebrate(origin: Element | null, count = 16) {
  if (reduced() || !origin) return;
  const box = origin.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:70;overflow:hidden';
  document.body.appendChild(layer);
  const bits: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const b = document.createElement('i');
    b.style.cssText = `position:absolute;left:${box.left + box.width / 2}px;top:${box.top + box.height / 2}px;width:8px;height:8px;border-radius:${i % 2 ? '50%' : '2px'};background:${CONFETTI[i % CONFETTI.length]}`;
    layer.appendChild(b);
    bits.push(b);
  }
  animate(bits, {
    translateX: () => utils.random(-120, 120), translateY: () => utils.random(-150, 40),
    rotate: () => utils.random(-240, 240), scale: [1, 0.4], opacity: [1, 0],
    duration: 950, ease: 'outCubic', onComplete: () => layer.remove(),
  });
  window.setTimeout(() => layer.remove(), 2000);
}

export function heroText(el: HTMLElement | null) {
  if (reduced() || !el) return;
  try {
    const split = splitText(el, { words: true });
    animate(split.words, { opacity: [0, 1], translateY: [18, 0], duration: 600, ease: 'outCubic', delay: stagger(60) });
  } catch { /* text stays as-is */ }
}

/** Unlock animation for a gated chapter: the folded panel opens and its children rise in. */
export function unfold(el: HTMLElement | null) {
  if (reduced() || !el) return;
  animate(el, { scaleY: [0.96, 1], opacity: [0.4, 1], duration: 520, ease: 'outCubic' });
  const kids = Array.from(el.children);
  if (kids.length) animate(kids, { opacity: [0, 1], translateY: [14, 0], duration: 420, ease: 'outCubic', delay: stagger(60, { start: 120 }) });
}

/** FLIP: animate elements from where they were (`before` rects, keyed by index) to where they are now. */
export function morphDots(els: HTMLElement[], before: DOMRect[]) {
  if (reduced()) return;
  els.forEach((el, i) => {
    const b = before[i];
    if (!b) return;
    const a = el.getBoundingClientRect();
    animate(el, { translateX: [b.left - a.left, 0], translateY: [b.top - a.top, 0], duration: 700, ease: 'outExpo' });
  });
}

/** Gentle idle loop (scale 1 -> 1.02). Returns a stop function. */
export function breathe(el: Element | null): () => void {
  if (reduced() || !el) return () => undefined;
  const a = animate(el, { scale: [1, 1.02, 1], duration: 3200, loop: true, ease: 'inOutSine' });
  return () => a.revert();
}
