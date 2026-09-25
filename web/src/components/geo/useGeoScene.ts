import { useEffect, type MutableRefObject, type RefObject } from 'react';
import { createTimeline } from 'animejs';
import { reduced } from '../../lib/motion';

export const SCENE_TOTAL = 1000;
type Timeline = ReturnType<typeof createTimeline>;
export type Query = (selector: string) => SVGElement[];

/**
 * Owns a paused anime timeline scrubbed by a progress ref: creation, seek on every change, the
 * reduced-motion short-circuit (nothing is built; the un-animated DOM is the finished picture) and
 * revert on unmount. `build` adds tweens with times in 0..SCENE_TOTAL.
 */
export function useGeoScene(svg: RefObject<SVGSVGElement>, progress: MutableRefObject<number>, build: (tl: Timeline, q: Query) => void) {
  useEffect(() => {
    const root = svg.current;
    if (!root) return;
    const q: Query = (s) => Array.from(root.querySelectorAll<SVGElement>(s));
    const tl = createTimeline({ autoplay: false, defaults: { ease: 'inOutSine' } });
    if (!reduced()) build(tl, q);
    let raf = 0;
    let last = -1;
    const tick = () => {
      const p = progress.current;
      if (p !== last) { last = p; tl.seek(p * SCENE_TOTAL); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); tl.revert(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg, progress]);
}
