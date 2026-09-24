import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AppConfig, type ErrorBody, type Song } from '../lib/api';
import { useAccountState } from '../lib/socket';
import { Button } from '../components/ui';
import { DeviceCard } from '../components/device/DeviceCard';

export default function DevicePage() {
  const [params, setParams] = useSearchParams();
  const username = params.get('account') ?? 'brij';
  const deviceNameQuery = params.get('device');

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
      if (a.ok) setAccountId(a.body.accountId);
      else setError(a.body.message ?? 'Account not found');
      if (s.ok) setSongs(s.body);
      if (c.ok) setConfig(c.body);
    }).catch(e => setError(e.message));
  }, [username]);

  const { snapshot } = useAccountState({ accountId });

  if (error) return <p className="text-rose-400 text-center py-10">{error}</p>;
  if (!accountId || !songs.length || !config || !snapshot) {
    return <p className="text-stone-500 text-center py-10">Loading...</p>;
  }

  const currentDevice = snapshot.devices.find(d => d.deviceName === deviceNameQuery);

  if (!currentDevice) {
    return (
      <div className="mx-auto max-w-sm space-y-6 pt-10">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-stone-900">Which device is this?</h1>
          <p className="mt-2 text-sm text-stone-600">Select this device to continue.</p>
        </div>
        <div className="flex flex-col gap-3">
          {snapshot.devices.map(d => (
            <Button
              key={d.deviceId}
              variant="secondary"
              size="lg"
              className="w-full justify-start text-base"
              onClick={() => setParams(p => { p.set('device', d.deviceName); return p; })}
            >
              {d.deviceType === 'MOBILE' ? '📱' : d.deviceType === 'TABLET' ? '📲' : d.deviceType === 'WEB' ? '🌐' : '💻'}
              <span className="ml-2">{d.deviceName}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      <DeviceCard
        accountId={accountId}
        device={currentDevice}
        songs={songs}
        heartbeatMs={config.heartbeatMs}
        large
      />
      <div className="text-center">
        <Link 
          to={`/device?account=${encodeURIComponent(username)}`}
          className="text-sm font-medium text-stone-500 hover:text-stone-800"
          onClick={(e) => {
            e.preventDefault();
            setParams(p => { p.delete('device'); return p; });
          }}
        >
          Switch device
        </Link>
      </div>
    </div>
  );
}
