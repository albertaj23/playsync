import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AppConfig, type Health } from '../lib/api';
import { Dot } from '../components/ui';

const STEPS = [
  { n: 1, title: 'One account, many devices', text: 'Your music account is signed in on a laptop, a phone, a tablet and a browser.' },
  { n: 2, title: 'One stream at a time', text: 'Your plan lets one device play at a time. Start on a second device and the app asks whether to move the music there.' },
  { n: 3, title: 'It holds up under pressure', text: 'Even if lots of devices press Play at the exact same moment, only the allowed number get through.' },
];

const DESTINATIONS = [
  { to: '/devices', emoji: '🎧', title: 'My devices', text: 'Play music on one device and watch the others react.' },
  { to: '/stress', emoji: '⚡', title: 'Stress test', text: 'Make lots of devices press Play at once. Does the limit hold?' },
  { to: '/nerds', emoji: '🔬', title: 'Stats for nerds', text: 'Every action, checked against the database, with all the numbers.' },
];

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);

  useEffect(() => {
    api.get<Health>('/health').then((r) => setHealth(r.body)).catch((e: Error) => setHealth({ ok: false, error: e.message }));
    api.get<AppConfig>('/config').then((r) => r.ok && setCfg(r.body)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-12">
      <section className="pt-4 text-center">
        <div className="mx-auto mb-5 flex w-fit gap-2 text-3xl" aria-hidden>
          <span>💻</span><span>📱</span><span>📲</span><span>🌐</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl">
          Listen anywhere.<br /><span className="text-violet-600">One device at a time.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-stone-600">
          A small music app that keeps all your devices in agreement about which one is playing, even when they all
          try at once.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/stress" className="rounded-xl bg-violet-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-violet-500">
            Try the stress test
          </Link>
          <Link to="/nerds" className="rounded-xl bg-white px-5 py-2.5 font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50">
            See how it works
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">{s.n}</div>
            <h2 className="mt-3 font-semibold text-stone-900">{s.title}</h2>
            <p className="mt-1 text-sm text-stone-600">{s.text}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {DESTINATIONS.map((d) => (
          <Link key={d.to} to={d.to} className="group rounded-2xl border border-stone-200 bg-white p-5 transition hover:border-violet-300 hover:shadow-md">
            <div className="text-2xl">{d.emoji}</div>
            <h2 className="mt-2 font-semibold text-stone-900 group-hover:text-violet-700">{d.title} →</h2>
            <p className="mt-1 text-sm text-stone-600">{d.text}</p>
          </Link>
        ))}
      </section>

      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <Dot tone={health === null ? 'stone' : health.ok ? 'green' : 'red'} />
          {health === null ? 'Checking the database…' : health.ok ? 'Connected to the database' : 'Database unreachable. Is Docker running?'}
        </span>
        {cfg && <span>A device that goes quiet for {cfg.leaseMs / 1000}s loses its stream</span>}
      </footer>
    </div>
  );
}
