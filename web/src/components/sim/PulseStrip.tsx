import { CountNumber, cx } from '../ui';
import type { Kpis } from '../../lib/sim';
import { BreachMeter } from './BreachMeter';

function Tile({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="glass-card rounded-2xl px-4 py-3">
      <div className="label-caps">{label}</div>
      <div className={cx('mt-0.5 font-display text-2xl font-semibold tabular-nums', tone === 'bad' ? 'text-rose-400' : tone === 'good' ? 'text-emerald-400' : 'text-stone-900')}>{children}</div>
    </div>
  );
}

/** The headline numbers. The breach meter and the violations counter are the biggest things on screen. */
export function PulseStrip({ kpis }: { kpis: Kpis | null }) {
  const k = kpis;
  const bad = (k?.newViolationEvents ?? 0) > 0;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
      <div className={cx('glass-card flex items-center gap-4 rounded-3xl px-5 py-4 transition-colors duration-500', bad ? 'border border-rose-500/50 bg-rose-500/8' : 'border border-emerald-500/30')}>
        <BreachMeter violating={k?.violatingHouseholds ?? 0} />
        <div className="min-w-0">
          <div className="label-caps">Households over their limit right now</div>
          <div className={cx('font-display text-5xl font-bold tabular-nums', (k?.violatingHouseholds ?? 0) > 0 ? 'text-rose-400' : 'text-emerald-400')}><CountNumber value={k?.violatingHouseholds ?? 0} /></div>
          <div className="text-sm text-stone-500">{k ? `${k.newViolationEvents} time${k.newViolationEvents === 1 ? '' : 's'} a limit broke · worst: ${k.peakExcess} over` : 'Waiting for a run'}</div>
        </div>
      </div>
      <Tile label="Listeners happy" tone={k && k.happinessPct < 80 ? 'bad' : undefined}>{k ? `${k.happinessPct}%` : '–'}</Tile>
      <Tile label="Time to start playing (p95)">{k ? `${k.p95Ms} ms` : '–'}</Tile>
      <Tile label="Songs started per second">{k ? k.playsPerSec : '–'}</Tile>
    </div>
  );
}
