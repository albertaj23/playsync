import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { reduced } from '../../lib/motion';
import { useScrollProgress } from '../../lib/story/useScrollProgress';

/**
 * A tall scene: the stage sticks under the top bar while the scene's progress (0..1) scrubs the
 * geometry and swaps captions at the cuts. Contains decoration and captions only, never controls.
 * Reduced motion: natural height, every caption listed in order beside the finished scene.
 */
export function StickyStage({ heightSvh = 180, cuts, caption, allCaptions, scene }: {
  heightSvh?: number;
  cuts: number[];
  caption: (step: number) => ReactNode;
  allCaptions: ReactNode;
  scene: (progress: MutableRefObject<number>) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { progress, step } = useScrollProgress(ref, cuts);
  const still = reduced();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    for (let el = ref.current?.parentElement; el && el !== document.body; el = el.parentElement) {
      const o = getComputedStyle(el).overflow;
      if (o !== 'visible') console.warn('StickyStage: ancestor with overflow', o, 'breaks position: sticky', el);
    }
  }, []);

  return (
    <div ref={ref} style={{ height: still ? 'auto' : `${heightSvh}svh` }}>
      <div className={still ? 'flex flex-col items-center gap-6 py-6 md:flex-row md:gap-10' : 'sticky top-[var(--topbar-h)] flex h-[var(--stage-h)] flex-col items-center justify-center gap-3 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+1rem)] md:flex-row md:gap-10 md:pb-0'}>
        <div className="order-2 w-full max-w-xl text-center md:order-1 md:text-left">{still ? allCaptions : caption(step)}</div>
        <div className="order-1 aspect-square w-[min(56vw,26rem)] shrink-0 md:order-2 md:w-[min(42vw,30rem)]">{scene(progress)}</div>
      </div>
    </div>
  );
}
