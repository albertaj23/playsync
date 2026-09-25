import { useState } from 'react';
import { Field, Segmented, cx } from '../ui';
import { AdaptiveSlider } from '../watermelon/adaptive-slider';
import { FRIENDLY_STRATEGY, type SimConfig, type StrategyName } from '../../lib/sim';

const STRATS = Object.keys(FRIENDLY_STRATEGY) as StrategyName[];
type Set = <K extends keyof SimConfig>(k: K, v: SimConfig[K]) => void;

function Slider({ label, hint, value, min, max, step = 1, unit = '', disabled, onChange }: {
  label: string; hint?: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; onChange: (v: number) => void;
}) {
  return <AdaptiveSlider label={label} hint={hint} value={value} min={min} max={max} step={step} unit={unit} disabled={disabled} onChange={onChange} />;
}

/** The five things that matter most. While a run is in progress only the live ones stay editable. */
export function EssentialConditions({ cfg, running, set }: { cfg: SimConfig; running: boolean; set: Set }) {
  return (
    <div className="space-y-4">
      <Field label="Protection" hint={running ? 'Live: change it mid-run and watch what happens' : undefined}>
        <select value={cfg.strategy} onChange={(e) => set('strategy', e.target.value as StrategyName)}
          className="w-full rounded-xl border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-stone-800 outline-none focus:border-violet-500/60">
          {STRATS.map((s) => <option key={s} value={s} disabled={s === 'CONSTRAINT' && cfg.maxStreams > 1}>{FRIENDLY_STRATEGY[s]}</option>)}
        </select>
      </Field>
      {cfg.strategy === 'TXN_RR' && (
        <Segmented value={cfg.isolation} disabled={running} onChange={(v) => set('isolation', v)}
          options={[{ value: 'REPEATABLE READ', label: 'Repeatable read' }, { value: 'READ COMMITTED', label: 'Read committed' }]} />
      )}
      <div>
        <div className="mb-1 text-sm font-medium text-stone-700">Screens allowed per household</div>
        <Segmented value={cfg.maxStreams} disabled={running} onChange={(v) => set('maxStreams', v)} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <Slider label="Households" value={cfg.accounts} min={1} max={16} disabled={running} onChange={(v) => set('accounts', v)} />
      <Slider label="Devices per household" value={cfg.devicesPerAccount} min={2} max={64} disabled={running} onChange={(v) => set('devicesPerAccount', v)} />
      <div>
        <div className="mb-1 text-sm font-medium text-stone-700">How people press Play</div>
        <Segmented value={cfg.arrival} disabled={running} onChange={(v) => set('arrival', v)}
          options={[{ value: 'BURST', label: 'All at once', hint: 'A wave of presses every few seconds' }, { value: 'STEADY', label: 'Steady' }, { value: 'RUSH', label: 'Rush hour', hint: 'Ramps up to peak' }]} />
      </div>
    </div>
  );
}

const TABS = ['Crowd', 'Network', 'Trouble'] as const;

/** Everything else, grouped into three small tabs behind one disclosure. */
export function MoreConditions({ cfg, running, set }: { cfg: SimConfig; running: boolean; set: Set }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Crowd');
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm font-semibold text-stone-500 hover:text-stone-800">{open ? '▾' : '▸'} More conditions</button>
      {open && (
        <div className="mt-3 space-y-4">
          <div className="flex gap-1 rounded-xl bg-fg/5 p-1" role="tablist">
            {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('flex-1 rounded-lg px-3 py-1.5 text-sm font-medium', tab === t ? 'bg-fg/12 text-stone-900' : 'text-stone-500')}>{t}</button>)}
          </div>
          {tab === 'Crowd' && <>
            {cfg.arrival !== 'BURST' && <Slider label="Presses per second, per household" value={cfg.ratePerSec} min={0.2} max={20} step={0.2} onChange={(v) => set('ratePerSec', v)} />}
            <Slider label="Run length" unit=" s" value={cfg.durationSec} min={10} max={180} disabled={running} onChange={(v) => set('durationSec', v)} />
            <div>
              <div className="mb-1 text-sm font-medium text-stone-700">When the limit is reached</div>
              <Segmented value={cfg.policy} disabled={running} onChange={(v) => set('policy', v)} options={[{ value: 'REJECT', label: 'Say no' }, { value: 'TAKEOVER', label: 'Switch over' }, { value: 'ASK', label: 'Ask first' }]} />
            </div>
          </>}
          {tab === 'Network' && <>
            <div className="rounded-2xl bg-fg/5 p-3 text-xs leading-relaxed text-stone-500">
              <strong className="text-stone-700">Two kinds of delay.</strong> Server hesitation holds the door open between checking and starting, which widens the race window (unsafe methods break). Network lag only slows the listener down: it hurts experience, never correctness.
            </div>
            <Slider label="Server hesitation" unit=" ms" value={cfg.checkDelayMs} min={0} max={50} onChange={(v) => set('checkDelayMs', v)} />
            <Slider label="Network lag" unit=" ms" value={cfg.jitterMs} min={0} max={500} step={10} onChange={(v) => set('jitterMs', v)} />
          </>}
          {tab === 'Trouble' && <>
            <Slider label="Flaky devices" unit="%" hint="Share of playing devices that fall asleep and stop checking in" value={cfg.offlinePct} min={0} max={50} onChange={(v) => set('offlinePct', v)} />
            <Slider label="Crash mid-play" unit="%" hint="Chance the server dies halfway through starting a song" value={cfg.crashPct} min={0} max={20} onChange={(v) => set('crashPct', v)} />
            <Slider label="How long a play ticket lasts" unit=" s" value={cfg.leaseSec} min={5} max={60} disabled={running} onChange={(v) => set('leaseSec', v)} />
          </>}
        </div>
      )}
    </div>
  );
}
