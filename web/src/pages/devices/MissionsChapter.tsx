import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { Crowd, DeviceShape, Gate } from '../../components/geo/pieces';
import { Button } from '../../components/ui';
import { celebrate, enterUp } from '../../lib/motion';

export const MISSIONS = [
  { id: 1, title: 'Two screens, one song each', text: 'Play music on two screens at once. (Set the limit to 2 first!)' },
  { id: 2, title: 'Take a nap', text: 'Send a screen offline, take over from another one, then wake the first one up.' },
  { id: 3, title: 'Change the rules', text: 'Change how many screens can play, or what happens when a new one starts.' },
];

function Art({ id }: { id: number }) {
  return (
    <svg viewBox="80 100 240 200" className="h-24 w-32 shrink-0" aria-hidden>
      {id === 1 && <><g transform="translate(-60 0) scale(.8)"><DeviceShape kind={0} /></g><g transform="translate(60 0) scale(.8)"><DeviceShape kind={1} /></g><Gate slots={2} /></>}
      {id === 2 && <><g opacity="0.6"><DeviceShape kind={3} color="#94a3b8" /></g><text x="230" y="170" fontSize="40" fill="#a78bfa" fontWeight="700">z</text><text x="250" y="140" fontSize="28" fill="#a78bfa" fontWeight="700">z</text></>}
      {id === 3 && <><Gate slots={3} /><Crowd n={6} cols={6} /></>}
    </svg>
  );
}

/** One mission at a time. Completing one celebrates and slides the next in. */
export function MissionsChapter({ done, onMark }: { done: number[]; onMark: (id: number) => void }) {
  const current = MISSIONS.find((m) => !done.includes(m.id));
  const card = useRef<HTMLDivElement>(null);
  const lastId = useRef<number | undefined>(current?.id);
  useEffect(() => {
    if (current?.id !== lastId.current) { enterUp(card.current); lastId.current = current?.id; }
  }, [current?.id]);

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-stone-500">{done.length} of {MISSIONS.length} done</p>
      {current ? (
        <div ref={card} className="glass-card flex flex-col items-center gap-5 rounded-3xl p-6 text-center sm:flex-row sm:text-left">
          <Art id={current.id} />
          <div className="flex-1">
            <h3 className="font-display text-xl font-semibold text-stone-900">{current.title}</h3>
            <p className="mt-1 text-stone-500">{current.text}</p>
            <Button className="mt-4" variant="secondary" onClick={(e) => { celebrate(e.currentTarget, 12); onMark(current.id); }}><Check size={16} /> Mark done</Button>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-3xl p-8 text-center"><p className="font-display text-2xl font-semibold text-emerald-400">All missions done 🎉</p><p className="mt-1 text-stone-500">You've seen everything this page can do.</p></div>
      )}
    </div>
  );
}
