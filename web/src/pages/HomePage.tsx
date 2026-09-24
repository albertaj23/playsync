import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, Zap, Microscope, Users, Hand, ShieldCheck } from 'lucide-react';
import { api, type AppConfig, type Health } from '../lib/api';
import { Dot } from '../components/ui';
import { Mascot } from '../components/Mascot';
import { useAnime } from '../lib/useAnime';
import { enterUp, heroText } from '../lib/motion';

const STEPS = [
  { icon: Users, title: 'One account, many screens', text: 'Your music is signed in on a laptop, a phone, a tablet and a browser, all at once.' },
  { icon: Hand, title: 'One turn at a time', text: 'Start music on a second screen and it politely asks: "Want the music here instead?"' },
  { icon: ShieldCheck, title: 'Fair, even in a stampede', text: 'Even if lots of screens tap Play at the very same moment, only the allowed number get in.' },
];

const DESTINATIONS = [
  { to: '/devices', label: 'My devices', sub: 'Play music on one screen and watch the others react.', icon: Headphones, tint: 'bg-emerald-500/15 text-emerald-400' },
  { to: '/stress', label: 'Stress test', sub: 'Make lots of screens press Play at once. Does the limit hold?', icon: Zap, tint: 'bg-amber-500/15 text-amber-400' },
  { to: '/nerds', label: 'Stats for nerds', sub: 'Every action, checked against the database, with all the numbers.', icon: Microscope, tint: 'bg-sky-500/15 text-sky-400' },
];

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const { animRef } = useAnime();
  const headline = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api.get<Health>('/health').then((r) => setHealth(r.body)).catch((e: Error) => setHealth({ ok: false, error: e.message }));
    api.get<AppConfig>('/config').then((r) => r.ok && setCfg(r.body)).catch(() => undefined);
  }, []);

  useEffect(() => {
    heroText(headline.current);
    enterUp('.step-card', { delay: 300 });
    enterUp('.dest-card', { delay: 500 });
  }, []);

  return (
    <div className="space-y-14" ref={animRef}>
      <section className="relative pt-4 text-center">
        <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
          <div className="h-64 w-96 rounded-full bg-violet-500/10 blur-3xl" />
        </div>
        <div className="mx-auto mb-3 w-fit bob"><Mascot mood="cheer" size={128} /></div>
        <p className="mx-auto mb-2 w-fit rounded-full bg-violet-500/12 px-3 py-1 text-sm font-semibold text-violet-400">Hi, I'm Melo, your music sidekick 🍉</p>
        <h1 ref={headline} className="text-4xl font-bold tracking-tight text-stone-950 sm:text-6xl">
          Listen anywhere. One screen at a time.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-stone-500">
          A music app that keeps all your devices in agreement about who's playing, even when they all try at once.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/devices" className="rounded-2xl bg-violet-600 px-6 py-3 font-semibold text-[#fff] shadow-lg shadow-violet-600/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-500 active:scale-95">
            Play with my devices 🎧
          </Link>
          <Link to="/stress" className="rounded-2xl bg-fg/6 px-6 py-3 font-semibold text-stone-700 ring-1 ring-fg/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-fg/10 active:scale-95">
            Try the stampede ⚡
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="step-card glass-card rounded-3xl p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500/15 text-violet-400"><s.icon size={20} /></span>
              <span className="font-display text-sm font-semibold text-stone-400">Step {i + 1}</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-stone-900">{s.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-500">{s.text}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {DESTINATIONS.map((d) => (
          <Link key={d.to} to={d.to} className="dest-card glass-card group rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 ${d.tint}`}><d.icon size={24} /></span>
            <h2 className="mt-4 text-lg font-semibold text-stone-900">
              {d.label} <span className="inline-block text-stone-400 transition-transform group-hover:translate-x-1">→</span>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-500">{d.sub}</p>
          </Link>
        ))}
      </section>

      <p className="text-center text-sm text-stone-500">
        Curious what a database race actually looks like?{' '}
        <Link to="/nerds?tab=stepper" className="font-semibold text-violet-400 transition-colors hover:text-violet-500">
          Watch two transactions collide, step by step →
        </Link>
      </p>

      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-2 text-sm text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <Dot tone={health === null ? 'stone' : health.ok ? 'green' : 'red'} />
          {health === null ? 'Warming up the speakers…' : health.ok ? 'Speakers are warm ✅' : "Can't reach the database. Is Docker running?"}
        </span>
        {cfg && <span>A screen that goes quiet for {cfg.leaseMs / 1000}s loses its turn</span>}
      </footer>
    </div>
  );
}
