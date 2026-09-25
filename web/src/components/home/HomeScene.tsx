import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Hand, ShieldCheck, Users } from 'lucide-react';
import { FEATURES } from '../../lib/chrome';
import { heroText } from '../../lib/motion';
import { StickyStage } from '../story/StickyStage';
import { GeoMascot } from './GeoMascot';

const STEPS = [
  { icon: Users, title: 'One account, many screens', text: 'Your music is signed in on a laptop, a phone, a tablet and a browser, all at once.' },
  { icon: Hand, title: 'One turn at a time', text: 'Start music on a second screen and it politely asks: "Want the music here instead?"' },
  { icon: ShieldCheck, title: 'Fair, even in a stampede', text: 'Even if lots of screens tap Play at the very same moment, only the allowed number get in.' },
];
export const HOME_CUTS = [0.08, 0.36, 0.68];

function Hero({ headline }: { headline?: React.RefObject<HTMLHeadingElement> }) {
  return (
    <div className="reveal">
      <p className="mb-3 inline-block rounded-full bg-violet-500/12 px-3 py-1 text-sm font-semibold text-violet-400">Hi, I'm Melo, your music sidekick 🍉</p>
      <h1 ref={headline} className="text-4xl font-bold tracking-tight text-stone-950 sm:text-6xl">Listen anywhere. One screen at a time.</h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-500">A music app that keeps all your devices in agreement about who's playing, even when they all try at once.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
        <Link to="/devices" viewTransition={FEATURES.viewTransitions} className="rounded-2xl bg-violet-600 px-6 py-3 font-semibold text-[#fff] shadow-lg shadow-violet-600/30 transition-all hover:-translate-y-0.5 hover:bg-violet-500 active:scale-95">Play with my devices 🎧</Link>
        <Link to="/stress" className="rounded-2xl bg-fg/6 px-6 py-3 font-semibold text-stone-700 ring-1 ring-fg/10 transition-all hover:-translate-y-0.5 hover:bg-fg/10 active:scale-95">Try the stampede ⚡</Link>
      </div>
    </div>
  );
}

function StepCard({ i }: { i: number }) {
  const s = STEPS[i]!;
  return (
    <div className="reveal glass-card rounded-3xl p-6 text-left">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-400"><s.icon size={22} /></span>
        <span className="font-display text-sm font-semibold text-stone-400">Step {i + 1} of 3</span>
      </div>
      <h2 className="mt-4 text-2xl font-semibold text-stone-900">{s.title}</h2>
      <p className="mt-2 text-stone-500">{s.text}</p>
      <div className="mt-4 flex gap-1.5" aria-hidden>
        {STEPS.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all duration-300 ${k === i ? 'w-8 bg-violet-500' : 'w-3 bg-fg/15'}`} />)}
      </div>
    </div>
  );
}

/** Home's scene chapter: the mascot assembles on load, scroll drives it, captions follow the cuts. */
export function HomeScene() {
  const headline = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const t = window.setTimeout(() => heroText(headline.current), 200); return () => window.clearTimeout(t); }, []);
  return (
    <StickyStage
      heightSvh={320}
      cuts={HOME_CUTS}
      caption={(step) => step < 0
        ? <div key="hero"><Hero headline={headline} /><p className="mt-6 text-sm text-stone-400">↓ Scroll and watch Melo explain</p></div>
        : <StepCard key={step} i={step} />}
      allCaptions={<div className="space-y-4"><Hero />{STEPS.map((_, i) => <StepCard key={i} i={i} />)}</div>}
      scene={(progress) => <GeoMascot progress={progress} />}
    />
  );
}
