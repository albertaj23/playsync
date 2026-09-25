import { Flag, Rocket } from 'lucide-react';
import { ActionBar } from '../../components/story/ActionBar';
import { Chapter } from '../../components/story/Chapter';
import { ChapterRail } from '../../components/story/ChapterRail';
import { NextHint } from '../../components/story/NextHint';
import { Story, useStory, type ChapterDef } from '../../components/story/Story';
import { Button } from '../../components/ui';
import { CompareChapter, Chooser, DeeperChapter, GuardChapter, RunChapter, SetupChapter, VerdictChapter } from './chapters';
import type { Experiment } from './experiment';
import { StressScene } from './Scenes';

const CHAPTERS: ChapterDef[] = [
  { id: 'choose', title: 'Pick a test', kind: 'work', glyph: 'spark' },
  { id: 'scene', title: 'The stampede', kind: 'scene', glyph: 'crowd' },
  { id: 'setup', title: 'How big?', kind: 'work', glyph: 'gate' },
  { id: 'guard', title: 'Pick a guard', kind: 'work', glyph: 'device' },
  { id: 'run', title: 'Let them in', kind: 'work', glyph: 'crowd' },
  { id: 'verdict', title: 'What happened?', kind: 'work', glyph: 'ring' },
  { id: 'compare', title: 'Race them all', kind: 'work', glyph: 'counter' },
  { id: 'deeper', title: 'Go deeper', kind: 'work', glyph: 'slice' },
];
const ACTION_CHAPTERS = ['setup', 'guard', 'run', 'verdict', 'compare'];
const SETTLE_MS = 1400;

/** One experiment as a story. Both experiments render through this; only the adapter and copy differ. */
export function StressStory({ exp, choice, onChoose }: { exp: Experiment; choice: 'stream' | 'count'; onChoose: (k: 'stream' | 'count') => void }) {
  return (
    <Story title="Stress test" chapters={CHAPTERS}>
      <Inner exp={exp} choice={choice} onChoose={onChoose} />
    </Story>
  );
}

function Inner({ exp, choice, onChoose }: { exp: Experiment; choice: 'stream' | 'count'; onChoose: (k: 'stream' | 'count') => void }) {
  const { goTo, autoAdvance } = useStory();
  // Jump to the result only if the user hasn't touched the page since pressing the button; wait for the dots to settle.
  const advance = (id: string, pressedAt: number) => window.setTimeout(() => autoAdvance(id, pressedAt, 'setup'), SETTLE_MS);
  const run = async () => { const t = Date.now(); if (await exp.run()) advance('verdict', t); };
  const compare = async () => { const t = Date.now(); if (await exp.compareAll()) advance('compare', t); };
  const hasResult = !!exp.result;
  return (
    <>
      <ChapterRail />
      <Chapter id="choose" kind="work" title="Stress test" question="Pick an experiment. Each one is a short story.">
        <Chooser value={choice} onPick={(k) => { onChoose(k); window.setTimeout(() => goTo('scene', { push: false }), 60); }} />
      </Chapter>
      <Chapter id="scene" kind="scene"><StressScene kind={choice} /></Chapter>
      <Chapter id="setup" kind="work" title="How big is the stampede?" question={choice === 'stream' ? 'Choose the crowd and the limit.' : 'Choose how many listeners.'}>
        <SetupChapter exp={exp} /><NextHint to="guard" />
      </Chapter>
      <Chapter id="guard" kind="work" title="Who guards the door?" question={choice === 'stream' ? 'Pick a protection method.' : 'Pick a counting method.'}>
        <GuardChapter exp={exp} /><NextHint to="run" />
      </Chapter>
      <Chapter id="run" kind="work" title="Ready? Let them in." question="Everyone goes at exactly the same moment.">
        <RunChapter exp={exp} onRun={run} />
      </Chapter>
      <Chapter id="verdict" kind="work" title="What happened?" gated={!hasResult} placeholder="Run the stampede to see what happens ↑">
        <VerdictChapter exp={exp} /><NextHint to="compare" />
      </Chapter>
      <Chapter id="compare" kind="work" title="Same stampede, every guard." question="Race all the methods against each other.">
        <CompareChapter exp={exp} onCompare={compare} /><NextHint to="deeper" />
      </Chapter>
      <Chapter id="deeper" kind="work" title="Go deeper" question="See it in slow motion, or scale it up."><DeeperChapter /></Chapter>
      <ActionBar chapters={ACTION_CHAPTERS}>
        <Button variant="primary" onClick={run} disabled={!!exp.running || !!exp.methodBlocked}><Rocket size={16} /> Run test</Button>
        <Button onClick={compare} disabled={!!exp.running}><Flag size={16} /> Compare all</Button>
        <span className="hidden px-2 text-xs text-stone-500 sm:inline">{exp.amount} · {exp.methods.find((m) => m.name === exp.method)?.label}</span>
      </ActionBar>
    </>
  );
}
