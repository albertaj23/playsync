import { Glyph } from '../geo/Glyph';
import { cx } from '../ui';
import { useStory } from './Story';

/** Right-edge rail of mini shapes (desktop). Click jumps; the active chapter is filled. */
export function ChapterRail() {
  const { chapters, active, goTo } = useStory();
  const activeIdx = chapters.findIndex((c) => c.id === active);
  if (chapters.length < 2) return null;
  return (
    <nav aria-label="Chapters" className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 lg:block">
      <ul className="flex flex-col items-center gap-2">
        {chapters.map((c, i) => {
          const isActive = i === activeIdx;
          return (
            <li key={c.id} className="group relative">
              <button onClick={() => goTo(c.id)} aria-label={`Go to chapter: ${c.title}`} aria-current={isActive ? 'step' : undefined}
                className={cx('grid h-8 w-8 place-items-center rounded-full transition-all duration-200 focus-visible:outline-2 focus-visible:outline-violet-500',
                  isActive ? 'scale-110 bg-violet-500 text-[#fff] shadow-lg shadow-violet-500/30' : i < activeIdx ? 'bg-violet-500/25 text-violet-400 hover:bg-violet-500/35' : 'bg-fg/8 text-stone-500 hover:bg-fg/14')}>
                <Glyph name={c.glyph} />
              </button>
              <span className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-stone-950 px-2 py-1 text-xs font-semibold text-[var(--bg)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {c.title}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
