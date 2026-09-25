import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gate } from '../../components/geo/pieces';
import { Mascot } from '../../components/Mascot';
import { RaceTrack } from '../../components/RaceTrack';
import { Verdict } from '../../components/Verdict';
import { Badge, Button, Field, inputCls, cx } from '../../components/ui';
import { AdaptiveSlider } from '../../components/watermelon/adaptive-slider';
import { DotField } from './DotField';
import type { Experiment } from './experiment';

export function Chooser({ value, onPick }: { value: 'stream' | 'count'; onPick: (k: 'stream' | 'count') => void }) {
  const cards = [
    { k: 'stream' as const, title: 'Pressing Play together', text: 'Lots of screens tap Play at once. Does the limit hold?', art: <Gate slots={1} /> },
    { k: 'count' as const, title: 'Counting plays', text: 'Lots of listeners finish a song at once. Is every play counted?', art: <g><rect x="150" y="260" width="100" height="22" rx="6" fill="#34d399" /><rect x="150" y="234" width="100" height="22" rx="6" fill="#38bdf8" /><rect x="150" y="208" width="100" height="22" rx="6" fill="#fbbf24" /></g> },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((c) => (
        <button key={c.k} onClick={() => onPick(c.k)} aria-pressed={value === c.k}
          className={cx('rounded-3xl border p-5 text-left transition-all hover:-translate-y-1 active:scale-[0.99]', value === c.k ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'glass-card border-transparent')}>
          <svg viewBox="60 100 280 200" className="h-24 w-full" aria-hidden>{c.art}</svg>
          <h3 className="mt-2 font-display text-xl font-semibold text-stone-900">{c.title}</h3>
          <p className="mt-1 text-sm text-stone-500">{c.text}</p>
        </button>
      ))}
    </div>
  );
}

export function SetupChapter({ exp }: { exp: Experiment }) {
  const [more, setMore] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <AdaptiveSlider label={exp.amountLabel} value={exp.amount} min={2} max={100} onChange={exp.setAmount} />
        {exp.setLimit && (
          <div>
            <div className="mb-2 text-sm font-medium text-stone-700">How many screens are allowed to play together?</div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => exp.setLimit!(n)} aria-pressed={exp.limit === n}
                  className={cx('rounded-2xl border p-2 text-center transition-all active:scale-95', exp.limit === n ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'glass-card border-transparent')}>
                  <svg viewBox="60 100 280 200" className="mx-auto h-12 w-full" aria-hidden><Gate slots={n} /></svg>
                  <span className="font-display font-semibold text-stone-900">{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {exp.delay && (
          <div>
            <button onClick={() => setMore((a) => !a)} className="text-sm text-stone-500 hover:text-stone-800" aria-expanded={more}>{more ? '▾' : '▸'} Advanced</button>
            {more && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Thinking time" hint="Pause between checking and starting">
                  <select className={inputCls} value={exp.delay.value} onChange={(e) => exp.delay!.set(Number(e.target.value))}>{[0, 5, 20, 50].map((n) => <option key={n} value={n}>{n} ms</option>)}</select>
                </Field>
                <Field label="Accounts" hint="Spread devices over accounts">
                  <select className={inputCls} value={exp.delay.accounts} onChange={(e) => exp.delay!.setAccounts(Number(e.target.value))}>{[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="glass-card rounded-3xl p-5"><DotField count={exp.amount} dots={null} running={false} /></div>
    </div>
  );
}

export function GuardChapter({ exp }: { exp: Experiment }) {
  return (
    <div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3">
        {exp.methods.map((m) => {
          const off = exp.kind === 'stream' && m.name === 'CONSTRAINT' && (exp.limit ?? 1) > 1;
          return (
            <button key={m.name} onClick={() => exp.setMethod(m.name)} disabled={off} aria-pressed={exp.method === m.name}
              className={cx('w-[78%] shrink-0 snap-center rounded-2xl border p-4 text-left transition-all disabled:opacity-40 md:w-auto', exp.method === m.name ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'glass-card border-transparent hover:-translate-y-0.5')}>
              <div className="flex items-center justify-between gap-2"><span className="text-2xl" aria-hidden>{m.glyph}</span>{!m.safe && <Badge tone="amber">risky</Badge>}</div>
              <div className="mt-2 font-display text-lg font-semibold text-stone-900">{m.label}</div>
              <p className="mt-1 text-sm text-stone-500">{m.idea}</p>
              {off && <p className="mt-2 text-xs text-amber-400">Only works when one screen is allowed.</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RunChapter({ exp, onRun }: { exp: Experiment; onRun: () => void }) {
  const label = exp.methods.find((m) => m.name === exp.method)?.label;
  return (
    <div className="glass-card space-y-4 rounded-3xl p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={onRun} disabled={!!exp.running || !!exp.methodBlocked}>{exp.running ? 'Stampede in progress…' : 'Let them in'}</Button>
        <span className="text-sm text-stone-500">{exp.amount} {exp.kind === 'stream' ? 'screens' : 'listeners'} · {label}</span>
      </div>
      {exp.methodBlocked && <p className="text-sm text-amber-400">{exp.methodBlocked}</p>}
      {exp.error && <p className="text-sm text-rose-400">{exp.error}</p>}
      {exp.running && <div className="flex items-center gap-2 text-sm text-violet-400"><div className="bob"><Mascot mood="wow" size={40} /></div> Everyone is tapping at once…</div>}
      <DotField count={exp.amount} dots={exp.result?.dots ?? null} running={!!exp.running} />
    </div>
  );
}

export function VerdictChapter({ exp }: { exp: Experiment }) {
  const r = exp.result;
  if (!r) return null;
  const dotCls = { ok: 'bg-emerald-500', over: 'bg-rose-500', busy: 'bg-stone-400', err: 'bg-amber-400', lost: 'bg-rose-500' } as const;
  return (
    <div className="space-y-4">
      <Verdict ok={r.ok} title={r.title} body={r.body} />
      <div className="flex flex-wrap gap-4 text-xs text-stone-500">
        {r.legend.map((l) => <span key={l.kind} className="inline-flex items-center gap-1.5"><span className={cx('h-2.5 w-2.5 rounded-full', dotCls[l.kind])} /> {l.label}</span>)}
      </div>
      <p className="text-sm text-stone-500">{r.footer}</p>
      <p className="text-xs text-stone-400">Saved to the lab history · <Link to={`/nerds?tab=runs&batch=${r.batchId}`} className="font-medium text-violet-400 hover:underline">see it in Stats for nerds →</Link></p>
    </div>
  );
}

export function CompareChapter({ exp, onCompare }: { exp: Experiment; onCompare: () => void }) {
  return (
    <div className="glass-card rounded-3xl p-5">
      <Button onClick={onCompare} disabled={!!exp.running}>Race them all</Button>
      {exp.hasComparison ? (
        <div className="mt-4">
          <RaceTrack lanes={exp.lanes} />
          <p className="mt-3 text-sm text-stone-500">{exp.kind === 'stream' ? 'The safe methods all hold the limit; they differ in cost.' : 'The safe methods all count exactly right; they differ in speed.'}</p>
          {exp.comparisonBatch && <p className="mt-2 text-xs text-stone-400">Saved to the lab history · <Link to={`/nerds?tab=runs&batch=${exp.comparisonBatch}`} className="font-medium text-violet-400 hover:underline">see it in Stats for nerds →</Link></p>}
        </div>
      ) : <p className="mt-4 text-sm text-stone-500">Same stampede, every guard, side by side.</p>}
    </div>
  );
}

export function DeeperChapter() {
  const items = [
    { to: '/nerds?tab=stepper', title: 'See it in slow motion', text: 'Two real transactions, one statement at a time.' },
    { to: '/nerds?tab=runs', title: 'Every run, saved', text: 'Compare numbers from all your experiments.' },
    { to: '/sim', title: 'Now try a whole city', text: 'Hundreds of listeners, live, with the dials in your hands.' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((i) => <Link key={i.to} to={i.to} className="glass-card rounded-3xl p-5 transition-all hover:-translate-y-1"><h3 className="font-display text-lg font-semibold text-stone-900">{i.title} →</h3><p className="mt-1 text-sm text-stone-500">{i.text}</p></Link>)}
    </div>
  );
}
