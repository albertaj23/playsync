import { useRef } from 'react';
import { Gate } from '../../components/geo/pieces';
import { useGeoScene } from '../../components/geo/useGeoScene';
import { SAT_COLORS } from '../../components/geo/pieces';
import { StickyStage } from '../../components/story/StickyStage';

const HERO_CUTS = [0.1, 0.4, 0.72];
const person = (i: number) => ({ x: 100 + (i % 10) * 20, y: 250 + Math.floor(i / 10) * 20 });

// Both scenes rest in their FINAL frame (reduced motion shows it) and animate from the beginning.
function StampedeGeo({ progress }: { progress: React.MutableRefObject<number> }) {
  const root = useRef<SVGSVGElement>(null);
  useGeoScene(root, progress, (tl, q) => {
    q('.person').forEach((p, i) => tl.add(p, { translateX: [-260 - (i % 5) * 20, 0], duration: 420 }, i * 8));
    tl.add(q('.gate-main'), { opacity: [1, 0], duration: 200 }, 450);
    q('.mini').forEach((m, i) => tl.add(m, { opacity: [0, 1], scale: [0.5, 1], translateY: [30, 0], duration: 260 }, 500 + i * 60));
  });
  return (
    <svg ref={root} viewBox="0 0 400 400" className="h-full w-full overflow-visible" role="img" aria-label="A crowd rushing a gate that splits into six different guards">
      <g className="gate-main" opacity="0"><Gate slots={1} /></g>
      {Array.from({ length: 30 }, (_, i) => <circle key={i} className="person" cx={person(i).x} cy={person(i).y} r="7" fill={SAT_COLORS[i % 4]} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />)}
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i} className="mini" transform={`translate(${40 + i * 58} 120)`} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <rect width="8" height="70" rx="3" fill="var(--s500)" /><rect x="34" width="8" height="70" rx="3" fill="var(--s500)" /><rect width="42" height="9" rx="3" fill="var(--s500)" />
        </g>
      ))}
    </svg>
  );
}

function CounterGeo({ progress }: { progress: React.MutableRefObject<number> }) {
  const root = useRef<SVGSVGElement>(null);
  useGeoScene(root, progress, (tl, q) => {
    q('.blk').forEach((b, i) => tl.add(b, { translateY: [-260, 0], duration: 300 }, i * 90));
    q('.lostblk').forEach((b, i) => {
      tl.add(b, { translateY: [-260, 0], duration: 300 }, 300 + i * 90);
      tl.add(b, { translateX: [0, 90 + i * 30], translateY: [0, 160], rotate: [0, 40], opacity: [1, 0], duration: 300 }, 700 + i * 60);
    });
  });
  return (
    <svg ref={root} viewBox="0 0 400 400" className="h-full w-full overflow-visible" role="img" aria-label="Blocks stacking on a counter while a few bounce away and get lost">
      {Array.from({ length: 5 }, (_, i) => <rect key={i} className="blk" x="150" y={300 - i * 26} width="100" height="22" rx="6" fill={SAT_COLORS[i % 4]} />)}
      {Array.from({ length: 3 }, (_, i) => <rect key={i} className="lostblk" x="150" y={170 - i * 26} width="100" height="22" rx="6" fill="#f43f5e" opacity="0" />)}
    </svg>
  );
}

export function StressScene({ kind }: { kind: 'stream' | 'count' }) {
  const stream = kind === 'stream';
  const captions = stream
    ? ['Imagine 30 screens on one account tapping Play in the very same second.', 'The account allows just one. Someone has to guard the door.', 'Different guards, different results. Let\'s test them.']
    : ['50 listeners finish the same song at the same moment.', 'Each one adds +1 to the play counter.', 'If two add at once, a +1 can get lost. Let\'s test it.'];
  const hero = (
    <div className="reveal">
      <h1 className="text-4xl font-bold tracking-tight text-stone-950 sm:text-5xl">{stream ? 'Pressing Play together' : 'Counting plays'}</h1>
      <p className="mt-3 text-lg text-stone-500">{stream ? 'What happens when lots of screens press Play in the same instant?' : 'What happens when lots of people finish a song in the same instant?'}</p>
    </div>
  );
  const cap = (t: string, k: number) => <div key={k} className="reveal glass-card rounded-3xl p-6 text-left"><p className="text-xl font-semibold text-stone-900">{t}</p></div>;
  return (
    <StickyStage heightSvh={170} cuts={HERO_CUTS}
      caption={(step) => step < 0 ? <div key="h">{hero}<p className="mt-6 text-sm text-stone-400">↓ Scroll to see the problem</p></div> : cap(captions[step]!, step)}
      allCaptions={<div className="space-y-4">{hero}{captions.map(cap)}</div>}
      scene={(p) => stream ? <StampedeGeo progress={p} /> : <CounterGeo progress={p} />} />
  );
}
