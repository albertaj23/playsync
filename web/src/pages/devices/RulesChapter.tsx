import { Gate } from '../../components/geo/pieces';
import { cx } from '../../components/ui';

const POLICIES = [
  { value: 'ASK', label: 'Ask first', story: 'A prompt asks whether to move the music.' },
  { value: 'TAKEOVER', label: 'Switch over', story: 'The newest screen gets the music right away.' },
  { value: 'REJECT', label: 'Keep it', story: 'The screen that is playing keeps its turn.' },
];

/** The two house rules as big tappable choices: a gate with N openings, and three policy cards. */
export function RulesChapter({ maxStreams, policy, onLimit, onPolicy }: {
  maxStreams: number; policy: string; onLimit: (n: number) => void; onPolicy: (p: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-3 font-semibold text-stone-800">How many screens can play at once?</h3>
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} onClick={() => onLimit(n)} aria-pressed={maxStreams === n}
              className={cx('rounded-2xl border p-3 text-center transition-all active:scale-95', maxStreams === n ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'glass-card border-transparent hover:-translate-y-0.5')}>
              <svg viewBox="60 100 280 200" className="mx-auto h-16 w-full" aria-hidden><Gate slots={n} /></svg>
              <span className="mt-1 block font-display text-lg font-semibold text-stone-900">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 font-semibold text-stone-800">When a new screen starts playing…</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {POLICIES.map((p) => (
            <button key={p.value} onClick={() => onPolicy(p.value)} aria-pressed={policy === p.value}
              className={cx('rounded-2xl border p-4 text-left transition-all active:scale-[0.98]', policy === p.value ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'glass-card border-transparent hover:-translate-y-0.5')}>
              <div className="font-display text-lg font-semibold text-stone-900">{p.label}</div>
              <p className="mt-1 text-sm text-stone-500">{p.story}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
