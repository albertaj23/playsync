import type { SimState } from '../../lib/sim';
import { HeatCell } from './DeviceTile';
import { HouseholdCard } from './HouseholdCard';
import { LimitMeter } from './LimitMeter';
import { cx } from '../ui';

const COMPACT_ABOVE = 128;

/** The Stage: full tiles up to 128 devices, then a compact heatmap with one square per device. */
export function HouseholdGrid({ sim }: { sim: SimState }) {
  const total = sim.names.reduce((n, h) => n + h.devices.length, 0);
  if (sim.names.length === 0) {
    return <div className="grid place-items-center rounded-2xl border border-dashed border-fg/15 px-6 py-16 text-center text-stone-500">Pick a preset and press Start to bring the crowd in.</div>;
  }
  const compact = total > COMPACT_ABOVE;
  return (
    <div className={cx('grid gap-3', compact ? 'grid-cols-1 sm:grid-cols-2' : sim.names.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
      {sim.names.map((h) => {
        const devs = h.devices.map((d) => sim.devices[`${h.id}:${d.id}`]);
        return compact ? (
          <section key={h.id} className={cx('glass-card rounded-2xl border p-3', (sim.households[h.id]?.active ?? 0) > (sim.households[h.id]?.max ?? 1) ? 'border-rose-500/70' : 'border-transparent')}>
            <h3 className="mb-1 font-display text-sm font-semibold text-stone-900">{h.name}</h3>
            <LimitMeter active={sim.households[h.id]?.active ?? 0} max={sim.households[h.id]?.max ?? 1} />
            <div className="mt-2 flex flex-wrap gap-1">
              {h.devices.map((d, i) => <HeatCell key={d.id} state={devs[i]?.state ?? 'IDLE'} title={`${d.name}: ${(devs[i]?.state ?? 'IDLE').toLowerCase()}`} />)}
            </div>
          </section>
        ) : (
          <HouseholdCard key={h.id} info={h} live={sim.households[h.id]} devices={devs} />
        );
      })}
    </div>
  );
}
