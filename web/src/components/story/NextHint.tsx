import { ArrowDown } from 'lucide-react';
import { useStory } from './Story';

/** End-of-chapter affordance; also the keyboard and screen-reader way to advance. */
export function NextHint({ to }: { to: string }) {
  const { chapters, goTo } = useStory();
  const c = chapters.find((x) => x.id === to);
  if (!c) return null;
  return (
    <div className="mt-8 flex justify-center">
      <button onClick={() => goTo(to)} className="inline-flex items-center gap-2 rounded-full bg-fg/6 px-4 py-2 text-sm font-semibold text-stone-600 ring-1 ring-fg/10 transition-all hover:-translate-y-0.5 hover:bg-fg/10 active:scale-95">
        Next: {c.title} <ArrowDown size={15} />
      </button>
    </div>
  );
}
