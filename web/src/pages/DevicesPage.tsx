import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AppConfig, type ErrorBody, type Song } from '../lib/api';
import { useAccountState } from '../lib/socket';
import { Button, Card, Segmented } from '../components/ui';
import { DeviceCard } from '../components/device/DeviceCard';

export default function DevicesPage() {
  const [params] = useSearchParams();
  const username = params.get('account') ?? 'brij';

  const [accountId, setAccountId] = useState<number | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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

  if (error) return <p className="text-rose-600 text-center py-10">{error}</p>;
  if (!accountId || !songs.length || !config || !snapshot) {
    return <p className="text-stone-500 text-center py-10">Loading...</p>;
  }

  const playingSessions = snapshot.sessions.filter(s => s.status === 'PLAYING');
  const playingDeviceNames = Array.from(new Set(playingSessions.map(s => s.deviceName)));
  
  let statusBanner = "Nothing is playing right now";
  if (playingDeviceNames.length === 1) {
    statusBanner = `Playing on ${playingDeviceNames[0]}`;
  } else if (playingDeviceNames.length > 1) {
    statusBanner = `Playing on ${playingDeviceNames.slice(0, -1).join(', ')} and ${playingDeviceNames.at(-1)} (${playingDeviceNames.length} of ${snapshot.maxStreams} allowed)`;
  }

  async function updateSettings(updates: { maxStreams?: number; conflictPolicy?: string }) {
    if (!accountId) return;
    setSettingsError(null);
    const r = await api.put<ErrorBody>(`/accounts/${accountId}/settings`, {
      maxStreams: updates.maxStreams ?? snapshot!.maxStreams,
      conflictPolicy: updates.conflictPolicy ?? snapshot!.conflictPolicy,
    });
    if (!r.ok) {
      setSettingsError(r.body.message ?? 'Failed to update settings');
    }
  }

  async function stopAll() {
    if (!accountId) return;
    await api.post(`/accounts/${accountId}/end-all`, {});
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">My devices</h1>
          <p className="mt-1 text-sm text-stone-600">{statusBanner}</p>
        </div>
        <Link to={`/device?account=${encodeURIComponent(username)}`} className="text-sm font-medium text-violet-600 hover:underline">
          Use your phone as one of these devices →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {snapshot.devices.map(device => (
          <DeviceCard
            key={device.deviceId}
            accountId={accountId}
            device={device}
            songs={songs}
            heartbeatMs={config.heartbeatMs}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Settings" padded>
          <div className="space-y-6">
            <div>
              <div className="mb-2 text-sm font-medium text-stone-700">Devices that can play at the same time</div>
              <Segmented
                value={snapshot.maxStreams}
                options={[1, 2, 3, 4].map(n => ({ value: n, label: String(n) }))}
                onChange={(v) => updateSettings({ maxStreams: v })}
              />
            </div>
            
            <div>
              <div className="mb-2 text-sm font-medium text-stone-700">When a new device starts playing</div>
              <Segmented
                value={snapshot.conflictPolicy}
                options={[
                  { value: 'ASK', label: 'Ask first', hint: 'Ask before moving the music' },
                  { value: 'TAKEOVER', label: 'Switch automatically', hint: 'Move the music to the newest device' },
                  { value: 'REJECT', label: 'Keep the current one', hint: "Let the device that's playing keep it" }
                ]}
                onChange={(v) => updateSettings({ conflictPolicy: v })}
              />
              <div className="mt-2 text-xs text-stone-500">
                {snapshot.conflictPolicy === 'ASK' && "Shows a prompt asking if you want to switch playback to the new device."}
                {snapshot.conflictPolicy === 'TAKEOVER' && "Playback moves to the new device immediately without asking."}
                {snapshot.conflictPolicy === 'REJECT' && "The new device will be told it cannot play."}
              </div>
            </div>

            {settingsError && (
              <div className="text-sm text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-100">
                {settingsError}
              </div>
            )}

            <div className="pt-4 border-t border-stone-100">
              <Button variant="danger" onClick={stopAll}>Stop everything</Button>
            </div>
          </div>
        </Card>

        <Card title="Try this" padded>
          <ol className="space-y-3 list-decimal list-inside text-sm text-stone-700">
            <li>Play on two devices.</li>
            <li>Take the MacBook offline, switch to the iPad, bring the MacBook back.</li>
            <li>Change the settings.</li>
          </ol>
        </Card>
      </div>

      <div className="text-center pt-8 border-t border-stone-200">
        <Link to="/nerds" className="text-sm font-mono font-medium text-stone-500 hover:text-stone-800">
          {'</>'} Stats for nerds
        </Link>
      </div>
    </div>
  );
}
