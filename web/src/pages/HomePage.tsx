import { useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  db?: { version: string; name: string; defaultIsolation: string };
  error?: string;
}

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: Error) => setHealth({ ok: false, error: e.message }));
  }, []);

  return (
    <section className="space-y-4 max-w-xl">
      <h1 className="text-2xl font-bold">PlaySync</h1>
      <p className="text-zinc-400">Multi-device playback coordination as a concurrency-control lab.</p>
      <div className="rounded border border-zinc-800 p-4 text-sm font-mono">
        {health === null && 'checking…'}
        {health?.ok && `MySQL ${health.db?.version} · db=${health.db?.name} · default isolation=${health.db?.defaultIsolation}`}
        {health && !health.ok && <span className="text-red-400">DB unreachable: {health.error}</span>}
      </div>
    </section>
  );
}
