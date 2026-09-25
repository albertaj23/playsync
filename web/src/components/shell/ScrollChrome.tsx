import { useEffect } from 'react';
import { FEATURES } from '../../lib/chrome';
import { reduced } from '../../lib/motion';
import { onFrame } from '../../lib/story/scrollBus';

const HYSTERESIS = 12;

/**
 * Scroll-aware chrome (I5) and ambient layer (I7), driven by the shared scroll bus.
 * Sets `html[data-chrome="hidden"]` on scroll-down (phones only, see index.css) and leans the
 * ambient shapes with scroll velocity. Chrome always returns at the top, the bottom, and on scroll-up.
 */
export function ScrollChrome() {
  useEffect(() => {
    const root = document.documentElement;
    const ambient = document.getElementById('ambient-layer');
    const still = reduced() || window.matchMedia?.('(pointer: coarse)').matches;
    let lastY = window.scrollY;
    let anchor = lastY;
    let hidden = false;
    const off = onFrame((vh, y) => {
      if (FEATURES.scrollAwareChrome) {
        const bottom = root.scrollHeight - vh - y < 4;
        let next = hidden;
        if (y < 80 || bottom || y < anchor - HYSTERESIS) next = false;
        else if (y > anchor + HYSTERESIS) next = true;
        if (y < anchor - HYSTERESIS || y > anchor + HYSTERESIS) anchor = y;
        if (next !== hidden) { hidden = next; if (next) root.dataset.chrome = 'hidden'; else delete root.dataset.chrome; }
      }
      if (FEATURES.ambientLayer && ambient && !still) {
        const v = y - lastY;
        ambient.style.transform = `translateY(${(-y * 0.04).toFixed(1)}px) skewY(${Math.max(-4, Math.min(4, v * 0.12)).toFixed(2)}deg)`;
      }
      lastY = y;
    });
    return () => { off(); delete root.dataset.chrome; };
  }, []);
  return null;
}

/** Faint background shapes (decoration only). One layer, transform-only. */
export function AmbientLayer() {
  if (!FEATURES.ambientLayer) return null;
  const bits = [[8, 20, 18, '#34d399'], [90, 12, 14, '#38bdf8'], [76, 64, 22, '#fbbf24'], [14, 70, 16, '#a78bfa'], [50, 88, 12, '#ff5c7a'], [30, 42, 10, '#38bdf8']] as const;
  return (
    <div id="ambient-layer" aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-40 transition-transform duration-300 ease-out">
      {bits.map(([x, y, s, c], i) => (
        <span key={i} className="absolute rounded-full" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, background: c, borderRadius: i % 2 ? '3px' : '9999px', transform: `rotate(${i * 25}deg)` }} />
      ))}
    </div>
  );
}
