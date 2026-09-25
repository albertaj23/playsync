import { useEffect, useRef } from 'react';
import { animate, utils } from 'animejs';
import { Bits, DeviceShape, Ring, Slice } from '../geo/pieces';
import { useGeoScene } from '../geo/useGeoScene';
import { FEATURES } from '../../lib/chrome';
import { reduced } from '../../lib/motion';

const DOCK = [[-95, -35], [-38, -92], [38, -92], [95, -35]] as const;
const ORBIT = [[-118, -118], [118, -118], [118, 118], [-118, 118]] as const;
const RING = [[-170, 0], [0, -170], [170, 0], [0, 170]] as const;
const ORIGIN = { transformBox: 'view-box', transformOrigin: '200px 200px' } as const;

/**
 * Melo rebuilt from geometric shapes. Motion layers never share an element:
 *  - `.fly` wrappers: intro assembly (from-values; resting DOM is the finished picture);
 *  - `.sat` / `.orbit` / `.bodyScroll` / `.ring`: the paused timeline scrubbed by scroll (useGeoScene);
 *  - eyes follow the pointer, blink, and the whole figure bobs (CSS).
 */
export function GeoMascot({ progress }: { progress: React.MutableRefObject<number> }) {
  const root = useRef<SVGSVGElement>(null);

  useGeoScene(root, progress, (tl, q) => {
    const sats = q('.sat');
    sats.forEach((s, i) => {
      const [dx, dy] = DOCK[i]!, [ox, oy] = ORBIT[i]!, [rx, ry] = RING[i]!;
      tl.add(s, { translateX: [dx, ox], translateY: [dy, oy], duration: 333 }, 0);
      tl.add(s, { scale: [1, 1.35, 1], duration: 93 }, 350 + i * 73);
      tl.add(s, { translateX: [ox, rx], translateY: [oy, ry], duration: 333 }, 667);
    });
    tl.add(q('.orbit'), { rotate: [0, 180], duration: 333 }, 333);
    tl.add(q('.bodyScroll'), { scale: [1, 0.86], rotate: [0, -6], duration: 500 }, 0);
    tl.add(q('.bodyScroll'), { scale: [0.86, 1], rotate: [-6, 0], duration: 500 }, 500);
    tl.add(q('.ring'), { strokeDashoffset: [1068, 0], duration: 300 }, 667);
    tl.add(q('.mouth-happy'), { opacity: [1, 0], duration: 100 }, 667);
    tl.add(q('.mouth-cheer'), { opacity: [0, 1], duration: 100 }, 667);
    q('.bit').forEach((b, i) => tl.add(b, { translateY: [0, (i % 2 ? -1 : 1) * (60 + i * 14)], rotate: [0, 200], duration: 1000 }, 0));
  });

  useEffect(() => {
    const svg = root.current;
    if (!svg || reduced()) return;
    const q = (s: string) => Array.from(svg.querySelectorAll<SVGElement>(s));
    let watchdog = 0;
    if (!document.hidden) {
      const anims = q('.fly').map((el, i) => animate(el, {
        translateX: [utils.random(-320, 320), 0], translateY: [utils.random(-320, 320), 0], rotate: [utils.random(-200, 200), 0],
        scale: [0, 1], opacity: [0, 1], delay: i * 60, ease: 'outElastic(1, .7)', duration: 1400,
      }));
      watchdog = window.setTimeout(() => anims.forEach((a) => a.complete()), 2500);
    }
    const blink = animate(q('.eye'), { scaleY: [1, 0.1, 1], duration: 220, loop: true, loopDelay: 3200, ease: 'inOutQuad' });
    const pupils = q('.pupil');
    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / r.width) * 3)) * 6;
      const y = Math.max(-1, Math.min(1, ((e.clientY - (r.top + r.height / 2)) / r.height) * 3)) * 5;
      pupils.forEach((p) => { p.style.transform = `translate(${x}px, ${y}px)`; });
    };
    window.addEventListener('pointermove', onMove);
    return () => { window.clearTimeout(watchdog); window.removeEventListener('pointermove', onMove); blink.revert(); };
  }, []);

  return (
    <svg ref={root} viewBox="0 0 400 400" style={{ viewTransitionName: FEATURES.viewTransitions ? 'hero-geo' : undefined }} className="bob h-full w-full overflow-visible" role="img" aria-label="Melo, a watermelon mascot built from geometric shapes">
      <g className="fly"><Ring /></g>
      <g className="fly"><Bits /></g>
      <g className="orbit" style={ORIGIN}>
        {[0, 1, 2, 3].map((i) => <g key={i} className="fly"><g className="sat" style={ORIGIN}><DeviceShape kind={i} /></g></g>)}
      </g>
      <g className="fly"><g className="bodyScroll" style={{ transformBox: 'view-box', transformOrigin: '200px 280px' }}>
        <Slice />
        <g className="eye" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}><circle cx="150" cy="262" r="17" fill="#fff" /><circle className="pupil" cx="150" cy="262" r="9" fill="#3b1d2a" /></g>
        <g className="eye" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}><circle cx="250" cy="262" r="17" fill="#fff" /><circle className="pupil" cx="250" cy="262" r="9" fill="#3b1d2a" /></g>
        <circle cx="118" cy="292" r="12" fill="#ff8fa3" opacity="0.7" /><circle cx="282" cy="292" r="12" fill="#ff8fa3" opacity="0.7" />
        <path className="mouth-happy" d="M170 292 Q200 318 230 292" stroke="#3b1d2a" strokeWidth="6" strokeLinecap="round" fill="none" />
        <path className="mouth-cheer" d="M166 288 Q200 336 234 288 Z" fill="#7f1d3a" stroke="#3b1d2a" strokeWidth="5" strokeLinejoin="round" opacity="0" />
      </g></g>
    </svg>
  );
}
