import { useRef } from 'react';
import { DeviceShape, Slice } from '../../components/geo/pieces';
import { useGeoScene } from '../../components/geo/useGeoScene';
import { FEATURES } from '../../lib/chrome';
import { StickyStage } from '../../components/story/StickyStage';

// Resting DOM is the finished picture (a row of screens, the laptop lit); the scene animates FROM the
// assembled cluster around the slice TO that row, so reduced motion simply shows the end state.
const ROW = [-135, -45, 45, 135];
const CLUSTER = [[-70, -80], [-25, -100], [25, -100], [70, -80]];

function DevicesGeo({ progress }: { progress: React.MutableRefObject<number> }) {
  const root = useRef<SVGSVGElement>(null);
  useGeoScene(root, progress, (tl, q) => {
    q('.dev').forEach((d, i) => {
      tl.add(d, { translateX: [CLUSTER[i]![0]!, ROW[i]!], translateY: [CLUSTER[i]![1]!, 90], duration: 550 }, i * 40);
    });
    tl.add(q('.slice'), { scale: [1, 0.5], translateY: [0, -60], duration: 550 }, 0);
    tl.add(q('.glow'), { opacity: [0, 1], scale: [0.6, 1], duration: 250 }, 600);
    q('.eqbar').forEach((b, i) => tl.add(b, { scaleY: [0.2, 1, 0.4], duration: 300 }, 650 + i * 60));
    tl.add(q('.dev'), { translateY: [90, 130], duration: 250 }, 800);
  });
  const o = { transformBox: 'view-box', transformOrigin: '200px 200px' } as const;
  return (
    <svg ref={root} viewBox="0 0 400 400" style={{ viewTransitionName: FEATURES.viewTransitions ? 'hero-geo' : undefined }} className="h-full w-full overflow-visible" role="img" aria-label="Four screens lining up to share one music account">
      <g className="slice" style={{ transformBox: 'view-box', transformOrigin: '200px 280px' }} transform="translate(0,-60) scale(0.5)"><g transform="translate(100 140)"><Slice /></g></g>
      <circle className="glow" cx="65" cy="290" r="46" fill="#34d399" opacity="0.25" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      {ROW.map((x, i) => (
        <g key={i} className="dev" style={o} transform={`translate(${x} 130)`}><DeviceShape kind={i} /></g>
      ))}
      <g transform="translate(65 300)" fill="#34d399">
        {[-12, 0, 12].map((x, i) => <rect key={i} className="eqbar" x={x - 3} y="-20" width="6" height="20" rx="3" style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }} />)}
      </g>
    </svg>
  );
}

export const MEET_CUTS = [0.12, 0.55];

/** Chapter 0: the four screens assemble around the account, then line up; the laptop lights up. */
export function MeetScene() {
  const hero = (
    <div className="reveal">
      <h1 className="text-4xl font-bold tracking-tight text-stone-950 sm:text-5xl">My devices</h1>
      <p className="mt-3 text-lg text-stone-500">These four screens share one music account.</p>
    </div>
  );
  const cap = (t: string) => <div className="reveal glass-card rounded-3xl p-6 text-left"><p className="text-xl font-semibold text-stone-900">{t}</p></div>;
  return (
    <StickyStage
      heightSvh={160}
      cuts={MEET_CUTS}
      caption={(step) => step < 0 ? <div key="h">{hero}<p className="mt-6 text-sm text-stone-400">↓ Scroll to meet them</p></div>
        : step === 0 ? <div key="a">{cap('One music account, four devices.')}</div>
        : <div key="b">{cap('Only one gets to play at a time… unless you change the rules.')}</div>}
      allCaptions={<div className="space-y-4">{hero}{cap('One music account, four devices.')}{cap('Only one gets to play at a time… unless you change the rules.')}</div>}
      scene={(progress) => <DevicesGeo progress={progress} />}
    />
  );
}
