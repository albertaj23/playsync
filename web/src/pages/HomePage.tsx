import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, Zap, Microscope } from 'lucide-react';
import { api, type AppConfig } from '../lib/api';
import { HomeScene } from '../components/home/HomeScene';
import { Chapter } from '../components/story/Chapter';
import { ChapterRail } from '../components/story/ChapterRail';
import { Story, type ChapterDef } from '../components/story/Story';
import { enterUp } from '../lib/motion';

const DESTINATIONS = [
  { to: '/devices', label: 'My devices', sub: 'Play music on one screen and watch the others react.', icon: Headphones, tint: 'bg-emerald-500/15 text-emerald-400' },
  { to: '/stress', label: 'Stress test', sub: 'Make lots of screens press Play at once. Does the limit hold?', icon: Zap, tint: 'bg-amber-500/15 text-amber-400' },
  { to: '/nerds', label: 'Stats for nerds', sub: 'Every action, checked against the database, with all the numbers.', icon: Microscope, tint: 'bg-sky-500/15 text-sky-400' },
];

export default function HomePage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const chapters = useMemo<ChapterDef[]>(() => [
    { id: 'story', title: 'Meet Melo', kind: 'scene', glyph: 'slice' },
    { id: 'next', title: 'Where to next?', kind: 'work', glyph: 'spark' },
  ], []);

  useEffect(() => { api.get<AppConfig>('/config').then((r) => r.ok && setCfg(r.body)).catch(() => undefined); }, []);
  useEffect(() => { enterUp('.dest-card', { delay: 200 }); }, []);

  return (
    <Story title="Home" chapters={chapters}>
      <ChapterRail />
      <Chapter id="story" kind="scene"><HomeScene /></Chapter>
      <Chapter id="next" kind="work" title="Where to next?" question="Pick what you'd like to do.">
        <div className="grid gap-4 md:grid-cols-3">
          {DESTINATIONS.map((d) => (
            <Link key={d.to} to={d.to} className="dest-card glass-card group rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <span className={`grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 ${d.tint}`}><d.icon size={24} /></span>
              <h3 className="mt-4 text-lg font-semibold text-stone-900">
                {d.label} <span className="inline-block text-stone-400 transition-transform group-hover:translate-x-1">→</span>
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-500">{d.sub}</p>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-stone-500">
          Curious what a database race actually looks like?{' '}
          <Link to="/nerds?tab=stepper" className="font-semibold text-violet-400 transition-colors hover:text-violet-500">Watch two transactions collide, step by step →</Link>
        </p>
        {cfg && <p className="mt-2 text-center text-sm text-stone-400">A screen that goes quiet for {cfg.leaseMs / 1000}s loses its turn.</p>}
      </Chapter>
    </Story>
  );
}
