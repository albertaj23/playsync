import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, type ErrorBody } from '../../lib/api';
import { useSimSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { DEFAULT_CONFIG, initialSim, LIVE_FIELDS, simReducer, type Preset, type SimConfig, type SimSnapshot } from '../../lib/sim';

const friendly = (status: number, body: ErrorBody) =>
  status === 409 ? 'Another experiment is running. Try again in a moment ⏳' : (body.message ?? 'Something went wrong');

/** All simulation state and actions in one place: socket ticks, the editable config, and the run controls. */
export function useSimControl() {
  const [sim, dispatch] = useReducer(simReducer, initialSim);
  const [cfg, setCfg] = useState<SimConfig>(DEFAULT_CONFIG);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const toast = useToast();
  const patchTimer = useRef<number | undefined>(undefined);

  const { connected } = useSimSocket({
    onSnapshot: (s) => { dispatch({ type: 'snapshot', s }); setLoaded(true); },
    onTick: (t) => dispatch({ type: 'tick', t }),
    onDone: (s) => dispatch({ type: 'done', s }),
  });

  useEffect(() => { api.get<{ presets: Preset[] }>('/lab/sim/presets').then((r) => r.ok && setPresets(r.body.presets)); }, []);

  // A tick from a run this tab didn't start carries no names: fetch the full state once.
  useEffect(() => {
    if (sim.households.length > 0 && sim.names.length !== sim.households.length) {
      api.get<SimSnapshot>('/lab/sim/state').then((r) => r.ok && dispatch({ type: 'snapshot', s: r.body }));
    }
  }, [sim.households.length, sim.names.length]);

  const running = sim.phase === 'RUNNING' || sim.phase === 'PAUSED' || sim.phase === 'STARTING' || sim.phase === 'STOPPING';
  const shown = running ? sim.config : cfg;

  const set = useCallback(<K extends keyof SimConfig>(k: K, v: SimConfig[K]) => {
    setActivePreset(null);
    if (running) {
      if (!(LIVE_FIELDS as readonly string[]).includes(k)) return;
      window.clearTimeout(patchTimer.current);
      patchTimer.current = window.setTimeout(async () => {
        const r = await api.patch<ErrorBody>('/lab/sim/config', { [k]: v });
        if (!r.ok) toast(friendly(r.status, r.body), 'warn');
      }, k === 'strategy' ? 0 : 250);
    }
    setCfg((c) => ({ ...c, [k]: v }));
  }, [running, toast]);

  async function call<T>(path: string, body?: unknown): Promise<T | null> {
    setBusy(true);
    const r = await api.post<T & ErrorBody>(path, body);
    setBusy(false);
    if (!r.ok) { toast(friendly(r.status, r.body), 'warn'); return null; }
    return r.body;
  }

  const start = async () => {
    const s = await call<SimSnapshot>('/lab/sim/start', cfg);
    if (s) dispatch({ type: 'snapshot', s });
    return !!s;
  };
  const stop = () => call('/lab/sim/stop');
  const pause = () => call('/lab/sim/pause');
  const resume = () => call('/lab/sim/resume');
  const repair = async () => {
    const r = await call<{ repaired: number; households: number }>('/lab/sim/repair');
    if (r) toast(r.repaired ? `Repaired ${r.households} household${r.households === 1 ? '' : 's'}: ${r.repaired} extra screens switched off` : 'Nothing to repair. Everyone is within their limit.', r.repaired ? 'good' : 'info');
  };
  const pick = (p: Preset) => { setActivePreset(p); setCfg({ ...DEFAULT_CONFIG, ...p.config }); };

  return { sim, cfg, shown, set, presets, activePreset, pick, running, busy, connected, loaded, start, stop, pause, resume, repair };
}

export type SimControl = ReturnType<typeof useSimControl>;
