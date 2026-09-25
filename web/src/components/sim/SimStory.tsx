import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Database, Newspaper, Pause, Play, RotateCcw, Square, Wrench } from 'lucide-react';
import { FEATURES } from '../../lib/chrome';
import { useSidebar } from '../../lib/shell';
import { useToast } from '../../lib/toast';
import { FRIENDLY_STRATEGY, type StrategyName } from '../../lib/sim';
import { ActionBar } from '../story/ActionBar';
import { Chapter } from '../story/Chapter';
import { ChapterRail } from '../story/ChapterRail';
import { NextHint } from '../story/NextHint';
import { Story, useStory, type ChapterDef } from '../story/Story';
import { Button, Card, cx } from '../ui';
import { CompareRuns } from './CompareRuns';
import { DatabaseOverlay } from './DatabaseOverlay';
import { FeedbackFeed } from './FeedbackFeed';
import { HouseholdGrid } from './HouseholdGrid';
import { PresetBar } from './PresetBar';
import { PulseStrip } from './PulseStrip';
import { EssentialConditions, MoreConditions } from './RelayConditions';
import { RunSummary } from './RunSummary';
import { SimScene } from './SimScene';
import { TimelineChart } from './TimelineChart';
import { useSimControl, type SimControl } from './useSimControl';

const CHAPTERS: ChapterDef[] = [
  { id: 'intro', title: 'A whole city', kind: 'scene', glyph: 'crowd' },
  { id: 'setup', title: 'Set the scene', kind: 'work', glyph: 'gate' },
  { id: 'live', title: 'Watch it live', kind: 'work', glyph: 'device' },
  { id: 'timeline', title: 'How it unfolded', kind: 'work', glyph: 'counter' },
  { id: 'results', title: 'The verdict', kind: 'work', glyph: 'ring' },
  { id: 'why', title: 'Why did this happen?', kind: 'work', glyph: 'slice' },
];
const SEEN = 'playsync-sim-seen';

export default function SimStory() {
  const c = useSimControl();
  return (
    <Story title="Simulation" chapters={CHAPTERS}>
      <Inner c={c} />
    </Story>
  );
}

function Inner({ c }: { c: SimControl }) {
  const { autoAdvance } = useStory();
  const { hash } = useLocation();
  const toast = useToast();
  const [feedOpen, setFeedOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState(false);
  const stopPressed = useRef<number | null>(null);
  const prevPhase = useRef(c.sim.phase);
  const placed = useRef(false);
  const { sim } = c;
  const live = sim.phase === 'RUNNING' || sim.phase === 'PAUSED';
  const { setForceRail } = useSidebar();
  useEffect(() => {
    if (!FEATURES.focusDuringRun) return;
    setForceRail(live);
    return () => setForceRail(false);
  }, [live, setForceRail]);

  // Reload mid-run lands on the live view; returning visitors skip the intro scene.
  useEffect(() => {
    if (!c.loaded || placed.current) return;
    placed.current = true;
    let seen = false;
    try { seen = localStorage.getItem(SEEN) === '1'; localStorage.setItem(SEEN, '1'); } catch { /* ignore */ }
    if (hash) return;
    const to = live ? 'live' : seen ? 'setup' : null;
    if (to) requestAnimationFrame(() => document.getElementById(to)?.scrollIntoView());
  }, [c.loaded, live, hash]);

  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = sim.phase;
    if (was !== 'DONE' && sim.phase === 'DONE' && sim.summary) {
      const t = stopPressed.current;
      stopPressed.current = null;
      if (t === null || !autoAdvance('results', t, 'live')) toast('The run finished. See the verdict below ↓', 'info');
    }
  }, [sim.phase, sim.summary, autoAdvance, toast]);

  const start = async () => { const t = Date.now(); if (await c.start()) autoAdvance('live', t, 'setup'); };
  const stop = async () => { stopPressed.current = Date.now(); await c.stop(); };
  const timelineUnlocked = sim.series.length >= 5 || !!sim.summary;
  const done = sim.phase === 'DONE' && !!sim.summary;

  return (
    <>
      <ChapterRail />
      <Chapter id="intro" kind="scene"><SimScene /></Chapter>

      <Chapter id="setup" kind="work" title="Set the scene" question="Pick a scenario, or build your own.">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
          <PresetBar presets={c.presets} activeId={c.activePreset?.id ?? null} disabled={c.running} onPick={c.pick} />
          <div className="min-w-0 flex-1 space-y-4">
            {c.activePreset && <div className="reveal rounded-3xl bg-violet-500/10 p-4"><p className="font-display text-lg font-semibold text-violet-400">{c.activePreset.label}</p><p className="text-sm text-stone-600">{c.activePreset.story}</p></div>}
            <Card title="The essentials"><div className="space-y-5"><EssentialConditions cfg={c.shown} running={c.running} set={c.set} /><MoreConditions cfg={c.shown} running={c.running} set={c.set} /></div></Card>
            {!c.running && <Button variant="primary" size="lg" className="w-full" onClick={start} disabled={c.busy || sim.phase === 'STARTING'}>{done ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />} {done ? 'Run again' : 'Start'}</Button>}
          </div>
        </div>
        <NextHint to="live" />
      </Chapter>

      <Chapter id="live" kind="work" title="Watch it live" question={live ? `${sim.phase === 'PAUSED' ? 'Paused' : 'Running'} · ${Math.max(0, Math.round(sim.config.durationSec - sim.elapsedMs / 1000))} s left` : 'Start a run to bring the crowd in.'}>
        <div className="sticky top-[calc(var(--topbar-h)+8px)] z-10 mb-4"><PulseStrip kpis={sim.kpis} /></div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0"><HouseholdGrid sim={sim} /></div>
          <aside className="hidden xl:block"><h3 className="mb-2 font-display font-semibold text-stone-800">What's happening</h3><FeedbackFeed events={sim.events} className="max-h-[70svh]" /></aside>
        </div>
        {feedOpen && (
          <div className="fixed inset-0 z-[58] bg-black/30 xl:hidden" onClick={() => setFeedOpen(false)}>
            <div className="surface sheet-up absolute inset-x-0 bottom-0 max-h-[75svh] overflow-y-auto rounded-t-3xl p-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-2 font-display font-semibold text-stone-800">What's happening</h3><FeedbackFeed events={sim.events} />
            </div>
          </div>
        )}
        <div className="mt-3 flex justify-end"><button onClick={() => setDbOpen(true)} className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-stone-500 hover:text-stone-900"><Database size={14} /> Show the database ▸</button></div>
        <NextHint to="timeline" />
      </Chapter>

      <Chapter id="timeline" kind="work" title="How it unfolded" gated={!timelineUnlocked} placeholder="Let a run go for a few seconds to see its timeline ↑">
        <div className="glass-card rounded-3xl p-5"><TimelineChart series={sim.series} markers={sim.markers} /></div>
        <NextHint to="results" />
      </Chapter>

      <Chapter id="results" kind="work" title="The verdict" gated={!done} placeholder="Finish a run to see the verdict ↑">
        {sim.summary && <div className="space-y-5"><RunSummary summary={sim.summary} /><Card title="Compare runs"><CompareRuns current={sim.summary} /></Card></div>}
        <NextHint to="why" />
      </Chapter>

      <Chapter id="why" kind="work" title="Why did this happen?" question="See the database's side of the story.">
        <div className="grid gap-4 md:grid-cols-2">
          <Link to="/nerds?tab=stepper" className="glass-card rounded-3xl p-5 transition-all hover:-translate-y-1"><h3 className="font-display text-lg font-semibold text-stone-900">Watch it statement by statement →</h3><p className="mt-1 text-sm text-stone-500">Two real transactions, one step at a time{c.activePreset ? ` (try the "${c.activePreset.label}" idea)` : ''}.</p></Link>
          <Link to="/nerds?tab=runs" className="glass-card rounded-3xl p-5 transition-all hover:-translate-y-1"><h3 className="font-display text-lg font-semibold text-stone-900">Every run, saved →</h3><p className="mt-1 text-sm text-stone-500">All your simulations, with the full numbers.</p></Link>
        </div>
      </Chapter>

      {dbOpen && <DatabaseOverlay sim={sim} scenarioId={c.activePreset?.explainScenario} onClose={() => setDbOpen(false)} />}
      <ActionBar chapters={['setup', 'live', 'timeline']}>
        {!c.running ? (
          <Button variant="primary" onClick={start} disabled={c.busy || sim.phase === 'STARTING' || sim.phase === 'STOPPING'}><Play size={16} fill="currentColor" /> {done ? 'Run again' : 'Start'}</Button>
        ) : (
          <>
            <select aria-label="Protection" value={sim.config.strategy} onChange={(e) => c.set('strategy', e.target.value as StrategyName)}
              className="rounded-xl border border-fg/10 bg-fg/5 px-2 py-2 text-sm font-semibold text-stone-800">
              {(Object.keys(FRIENDLY_STRATEGY) as StrategyName[]).map((s) => <option key={s} value={s} disabled={s === 'CONSTRAINT' && sim.config.maxStreams > 1}>{FRIENDLY_STRATEGY[s]}</option>)}
            </select>
            {sim.phase === 'PAUSED' ? <Button variant="play" onClick={c.resume} disabled={c.busy}><Play size={16} /> Resume</Button> : <Button onClick={c.pause} disabled={c.busy}><Pause size={16} /> Pause</Button>}
            <Button onClick={c.repair} disabled={c.busy || (sim.kpis?.violatingHouseholds ?? 0) === 0}><Wrench size={16} /> Repair now</Button>
            <Button variant="danger" onClick={stop} disabled={c.busy}><Square size={14} /> Stop</Button>
            <Button onClick={() => setDbOpen(true)}><Database size={16} /> Database</Button>
            <Button className={cx('xl:hidden')} onClick={() => setFeedOpen(true)}><Newspaper size={16} /> Feed ({sim.events.length})</Button>
          </>
        )}
      </ActionBar>
    </>
  );
}
