import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Power, Sparkles } from 'lucide-react';
import { api, type AppConfig, type ErrorBody, type Song } from '../../lib/api';
import { useAccountState } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { Button } from '../../components/ui';
import { Mascot } from '../../components/Mascot';
import { DevicesTour, tourSeen } from '../../components/DevicesTour';
import { ActionBar } from '../../components/story/ActionBar';
import { Chapter } from '../../components/story/Chapter';
import { ChapterRail } from '../../components/story/ChapterRail';
import { NextHint } from '../../components/story/NextHint';
import { Story, useStory, type ChapterDef } from '../../components/story/Story';
import type { DeviceMessage } from '../../lib/useDeviceSession';
import { enterUp } from '../../lib/motion';
import { MeetScene } from './MeetScene';
import { MissionsChapter } from './MissionsChapter';
import { MoreChapter } from './MoreChapter';
import { RulesChapter } from './RulesChapter';
import { ScreensChapter } from './ScreensChapter';

const CHAPTERS: ChapterDef[] = [
  { id: 'meet', title: 'Meet your screens', kind: 'scene', glyph: 'device' },
  { id: 'screens', title: 'Your screens', kind: 'work', glyph: 'crowd' },
  { id: 'missions', title: 'Little missions', kind: 'work', glyph: 'spark' },
  { id: 'rules', title: 'House rules', kind: 'work', glyph: 'gate' },
  { id: 'more', title: 'Curious?', kind: 'work', glyph: 'ring' },
];

export default function DevicesPage() {
  const [params] = useSearchParams();
  const username = params.get('account') ?? 'brij';
  const [accountId, setAccountId] = useState<number | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ accountId: number } & ErrorBody>(`/accounts/lookup?username=${encodeURIComponent(username)}`),
      api.get<Song[]>('/songs'),
      api.get<AppConfig>('/config'),
    ]).then(([a, s, c]) => {
      if (a.ok) setAccountId(a.body.accountId); else setError(a.body.message ?? 'Account not found');
      if (s.ok) setSongs(s.body);
      if (c.ok) setConfig(c.body);
    }).catch((e) => setError(e.message));
  }, [username]);

  const { snapshot } = useAccountState({ accountId });
  if (error) return <p className="py-10 text-center text-rose-400">{error}</p>;
  if (!accountId || !songs.length || !config || !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-stone-500">
        <div className="bob"><Mascot mood="sleepy" size={96} /></div>
        Warming up the speakers…
      </div>
    );
  }
  return <DevicesStory username={username} accountId={accountId} songs={songs} config={config} snapshot={snapshot} />;
}

type Snap = NonNullable<ReturnType<typeof useAccountState>['snapshot']>;

function DevicesStory({ username, accountId, songs, config, snapshot }: { username: string; accountId: number; songs: Song[]; config: AppConfig; snapshot: Snap }) {
  const toast = useToast();
  const [done, setDone] = useState<number[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const mark = (id: number) => setDone((d) => (d.includes(id) ? d : [...d, id]));

  useEffect(() => { if (snapshot.sessions.filter((s) => s.status === 'PLAYING').length >= 2) mark(1); }, [snapshot]);
  const onEvent = (m: DeviceMessage) => {
    if ((m.kind === 'moved' || m.kind === 'timedOut') && m.whileOffline) mark(2);
  };

  async function updateSettings(u: { maxStreams?: number; conflictPolicy?: string }) {
    const r = await api.put<ErrorBody>(`/accounts/${accountId}/settings`, {
      maxStreams: u.maxStreams ?? snapshot.maxStreams, conflictPolicy: u.conflictPolicy ?? snapshot.conflictPolicy,
    });
    if (!r.ok) toast(r.body.message ?? "Couldn't save that setting. Try again?", 'warn');
    else { toast('Saved! Your rules are updated.', 'good'); mark(3); }
  }
  async function stopAll() {
    await api.post(`/accounts/${accountId}/end-all`, {});
    toast('All quiet now. Everything stopped 🤫', 'info');
  }

  const commands = useMemo(() => [
    { id: 'stop', title: 'Stop everything', action: () => { void stopAll(); } },
    { id: 'tour', title: 'Take the tour', action: () => setTourOpen(true) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [accountId]);

  return (
    <Story title="My devices" chapters={CHAPTERS} commands={commands}>
      <ChapterRail />
      <TourGate open={tourOpen} setOpen={setTourOpen} />
      <Chapter id="meet" kind="scene"><MeetScene /></Chapter>
      <Chapter id="screens" kind="work" title="Your screens" question="Tap Play on any screen. Then try another one.">
        <ScreensChapter accountId={accountId} snapshot={snapshot} songs={songs} heartbeatMs={config.heartbeatMs} onEvent={onEvent} />
        <NextHint to="missions" />
      </Chapter>
      <Chapter id="missions" kind="work" title="Little missions" question="Three things worth trying.">
        <MissionsChapter done={done} onMark={mark} />
        <NextHint to="rules" />
      </Chapter>
      <Chapter id="rules" kind="work" title="House rules" question="You decide how sharing works.">
        <RulesChapter maxStreams={snapshot.maxStreams} policy={snapshot.conflictPolicy}
          onLimit={(n) => updateSettings({ maxStreams: n })} onPolicy={(p) => updateSettings({ conflictPolicy: p })} />
        <NextHint to="more" />
      </Chapter>
      <Chapter id="more" kind="work" title="Curious?" question="See what happened behind the scenes, or use your real phone.">
        <MoreChapter username={username} onTour={() => setTourOpen(true)} />
      </Chapter>
      <ActionBar chapters={['screens', 'missions', 'rules']}>
        <Button variant="danger" onClick={stopAll}><Power size={16} /> Stop everything</Button>
        <Button onClick={() => setTourOpen(true)}><Sparkles size={16} /> Take the tour</Button>
      </ActionBar>
    </Story>
  );
}

/** Returning visitors skip straight to their screens; first-timers get the tour once they reach them. */
function TourGate({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { active, goTo } = useStory();
  const { hash } = useLocation();
  const skipped = useRef(false);
  useEffect(() => {
    if (skipped.current) return;
    skipped.current = true;
    if (!hash && tourSeen()) requestAnimationFrame(() => document.getElementById('screens')?.scrollIntoView());
    enterUp('.device-card', { step: 90 });
  }, [hash, goTo]);
  const offered = useRef(false);
  useEffect(() => {
    if (active === 'screens' && !offered.current && !tourSeen()) { offered.current = true; setOpen(true); }
  }, [active, setOpen]);
  return <DevicesTour open={open} onClose={() => setOpen(false)} />;
}
