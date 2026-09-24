import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AppConfig, type ErrorBody, type Song } from '../lib/api';
import { useAccountState } from '../lib/socket';
import { Button, Card, Segmented } from '../components/ui';
import { DeviceCard } from '../components/device/DeviceCard';
import { useAnime } from '../lib/useAnime';
import { enterUp, celebrate } from '../lib/motion';
import { DevicesTour } from '../components/DevicesTour';
import { Mascot } from '../components/Mascot';
import { useToast } from '../lib/toast';

const TRY_STEPS = [
  { id: 1, text: 'Play music on two screens at once (set the limit to 2 first!).' },
  { id: 2, text: 'Send a screen offline for a nap, take over from another one, then wake it up.' },
  { id: 3, text: 'Change how many screens can play, or what happens when a new one starts.' },
];

export default function DevicesPage() {
  const [params] = useSearchParams();
  const username = params.get('account') ?? 'brij';

  const [accountId, setAccountId] = useState<number | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [doneSteps, setDoneSteps] = useState<number[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<{ accountId: number } & ErrorBody>(`/accounts/lookup?username=${encodeURIComponent(username)}`),
      api.get<Song[]>('/songs'),
      api.get<AppConfig>('/config'),
    ]).then(([a, s, c]) => {
      if (a.ok) setAccountId(a.body.accountId);
      else setError(a.body.message ?? 'Account not found');
      if (s.ok) setSongs(s.body);
      if (c.ok) setConfig(c.body);
    }).catch(e => setError(e.message));
  }, [username]);

  const { snapshot } = useAccountState({ accountId });

  const { animRef } = useAnime();
  const toast = useToast();

  const isReady = !!(accountId && songs.length && config && snapshot);

  // Auto-check step 1 when 2+ devices play
  useEffect(() => {
    if (!snapshot) return;
    const playingCount = snapshot.sessions.filter(s => s.status === 'PLAYING').length;
    if (playingCount >= 2 && !doneSteps.includes(1)) setDoneSteps(p => [...p, 1]);
  }, [snapshot]);

  useEffect(() => {
    if (isReady) {
      // Cards are visible by default; the animation only adds motion, so it can never hide them.
      enterUp('.device-card', { step: 90 });
    }
  }, [isReady]);

  if (error) return <p className="text-rose-400 text-center py-10">{error}</p>;
  if (!accountId || !songs.length || !config || !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-stone-500">
        <div className="bob"><Mascot mood="sleepy" size={96} /></div>
        Warming up the speakers…
      </div>
    );
  }

  const playingSessions = snapshot.sessions.filter(s => s.status === 'PLAYING');
  const playingDeviceNames = Array.from(new Set(playingSessions.map(s => s.deviceName)));

  let statusBanner = 'Nothing is playing. Pick a song and tap Play 🎵';
  if (playingDeviceNames.length === 1) statusBanner = `Playing on ${playingDeviceNames[0]}`;
  else if (playingDeviceNames.length > 1) {
    statusBanner = `Playing on ${playingDeviceNames.slice(0, -1).join(', ')} and ${playingDeviceNames.at(-1)} (${playingDeviceNames.length} / ${snapshot.maxStreams})`;
  }

  async function updateSettings(updates: { maxStreams?: number; conflictPolicy?: string }) {
    if (!accountId) return;
    setSettingsError(null);
    const r = await api.put<ErrorBody>(`/accounts/${accountId}/settings`, {
      maxStreams: updates.maxStreams ?? snapshot!.maxStreams,
      conflictPolicy: updates.conflictPolicy ?? snapshot!.conflictPolicy,
    });
    if (!r.ok) setSettingsError(r.body.message ?? "Couldn't save that setting. Try again?");
    else {
      toast('Saved! Your settings are updated.', 'good');
      if (!doneSteps.includes(3)) setDoneSteps(p => [...p, 3]);
    }
  }

  async function stopAll() {
    if (!accountId) return;
    await api.post(`/accounts/${accountId}/end-all`, {});
    toast('All quiet now. Everything stopped 🤫', 'info');
  }

  return (
    <div className="space-y-8" ref={animRef}>
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-950 tracking-tight">My devices</h1>
          <p className="mt-1 text-sm text-stone-500">{statusBanner}</p>
        </div>
        <div className="flex items-center gap-4"><DevicesTour /><Link to={`/device?account=${encodeURIComponent(username)}`} className="text-sm font-medium text-violet-400 hover:text-violet-300 transition-colors">
          Use your phone as one of these devices →
        </Link></div>
      </div>

      {/* ── Device grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {snapshot.devices.map(device => (
          <div key={device.deviceId} className="device-card">
            <DeviceCard
              accountId={accountId}
              device={device}
              songs={songs}
              heartbeatMs={config.heartbeatMs}
            />
          </div>
        ))}
      </div>

      {/* ── Settings + Try this ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Settings" padded>
          <div className="space-y-6">
            <div>
              <div className="label-caps mb-2">How many screens can play at once</div>
              <Segmented
                value={snapshot.maxStreams}
                options={[1, 2, 3, 4].map(n => ({ value: n, label: String(n) }))}
                onChange={(v) => updateSettings({ maxStreams: v })}
              />
            </div>

            <div>
              <div className="label-caps mb-2">When a new screen starts playing</div>
              <Segmented
                value={snapshot.conflictPolicy}
                options={[
                  { value: 'ASK',      label: 'Ask',      hint: 'Ask before moving the music' },
                  { value: 'TAKEOVER', label: 'Switch',   hint: 'Move the music to the newest device' },
                  { value: 'REJECT',   label: 'Keep',     hint: "Let the device that's playing keep it" },
                ]}
                onChange={(v) => updateSettings({ conflictPolicy: v })}
              />
              <div className="mt-2 text-xs text-stone-400">
                {snapshot.conflictPolicy === 'ASK'      && 'Shows a prompt asking if you want to switch playback.'}
                {snapshot.conflictPolicy === 'TAKEOVER' && 'Playback moves to the new device immediately.'}
                {snapshot.conflictPolicy === 'REJECT'   && 'The new device will be told it cannot play.'}
              </div>
            </div>

            {settingsError && (
              <div className="text-sm text-rose-400 bg-rose-500/8 p-3 rounded-xl border border-rose-500/20">
                {settingsError}
              </div>
            )}

            <div className="pt-4 border-t border-fg/6">
              <Button variant="danger" onClick={stopAll}>Stop everything</Button>
            </div>
          </div>
        </Card>

        {/* Interactive guided steps */}
        <Card title="Try this" subtitle="Little missions to explore what this app can do" padded>
          <ol className="space-y-3">
            {TRY_STEPS.map(step => {
              const done = doneSteps.includes(step.id);
              return (
                <li key={step.id} className="flex items-start gap-3">
                  <button
                    onClick={(e) => {
                      if (!done) celebrate(e.currentTarget, 10);
                      setDoneSteps(p => p.includes(step.id) ? p.filter(x => x !== step.id) : [...p, step.id]);
                    }}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all duration-300 ${
                      done
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                        : 'border-stone-300 text-stone-400 hover:border-stone-500'
                    }`}
                  >
                    {done ? '✓' : step.id}
                  </button>
                  <span className={`text-sm leading-relaxed transition-colors duration-300 ${done ? 'text-stone-400 line-through' : 'text-stone-700'}`}>
                    {step.text}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      <div className="text-center pt-6 border-t border-fg/5">
        <Link to="/nerds" className="text-sm font-mono text-stone-400 hover:text-stone-700 transition-colors">
          {'</>'} Stats for nerds
        </Link>
      </div>
    </div>
  );
}
