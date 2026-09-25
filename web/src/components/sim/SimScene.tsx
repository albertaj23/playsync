import { useRef } from 'react';
import { DeviceShape, SAT_COLORS } from '../geo/pieces';
import { useGeoScene } from '../geo/useGeoScene';
import { StickyStage } from '../story/StickyStage';

const HOUSEHOLDS = Array.from({ length: 16 }, (_, i) => ({ x: 70 + (i % 4) * 86, y: 90 + Math.floor(i / 4) * 86 }));

// Rests in its final frame (16 households); the timeline grows the city from one household.
function CityGeo({ progress }: { progress: React.MutableRefObject<number> }) {
  const root = useRef<SVGSVGElement>(null);
  useGeoScene(root, progress, (tl, q) => {
    q('.hh').forEach((h, i) => {
      if (i === 0) return;
      const t = i < 4 ? 80 + i * 60 : 400 + (i - 4) * 40;
      tl.add(h, { opacity: [0, 1], scale: [0.3, 1], duration: 200 }, t);
    });
  });
  return (
    <svg ref={root} viewBox="0 0 400 400" className="h-full w-full overflow-visible" role="img" aria-label="Households multiplying into a whole city of listeners">
      {HOUSEHOLDS.map((h, i) => (
        <g key={i} className="hh" transform={`translate(${h.x} ${h.y})`} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <path d="M-22 0 A22 22 0 0 0 22 0 Z" fill="#ff5c7a" />
          <path d="M-22 0 A22 22 0 0 0 22 0" fill="none" stroke="#22c55e" strokeWidth="4" />
          {[0, 1, 2].map((k) => <g key={k} transform={`translate(${-20 + k * 20} -16) scale(.22)`}><g transform="translate(-200 -200)"><DeviceShape kind={k + i} color={SAT_COLORS[(k + i) % 4]} /></g></g>)}
        </g>
      ))}
    </svg>
  );
}

export function SimScene() {
  const hero = (
    <div className="reveal">
      <h1 className="text-4xl font-bold tracking-tight text-stone-950 sm:text-5xl">Simulation control room</h1>
      <p className="mt-3 text-lg text-stone-500">A whole city of listeners, pressing Play on real requests to a real database.</p>
    </div>
  );
  const cap = (t: string, k: number) => <div key={k} className="reveal glass-card rounded-3xl p-6 text-left"><p className="text-xl font-semibold text-stone-900">{t}</p></div>;
  const caps = ['Many households, many screens, all pressing Play.', 'You set the conditions. We run the crowd and watch what breaks.'];
  return (
    <StickyStage heightSvh={130} cuts={[0.12, 0.55]}
      caption={(step) => step < 0 ? <div key="h">{hero}<p className="mt-6 text-sm text-stone-400">↓ Scroll to set the scene</p></div> : cap(caps[Math.min(step, 1)]!, step)}
      allCaptions={<div className="space-y-4">{hero}{caps.map(cap)}</div>}
      scene={(p) => <CityGeo progress={p} />} />
  );
}
