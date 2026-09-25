import { TriangleAlert } from 'lucide-react';
import { cx } from '../ui';
import type { DeviceDiff, HouseholdInfo } from '../../lib/sim';
import { DeviceTile } from './DeviceTile';
import { LimitMeter } from './LimitMeter';

export function HouseholdCard({ info, live, devices }: {
  info: HouseholdInfo; live: { active: number; max: number } | undefined; devices: (DeviceDiff | undefined)[];
}) {
  const active = live?.active ?? 0;
  const max = live?.max ?? 1;
  const over = active > max;
  return (
    <section className={cx('glass-card rounded-2xl border p-3 transition-colors duration-300', over ? 'border-rose-500/70 shadow-[0_0_24px_-8px_rgba(244,63,94,0.6)]' : 'border-transparent')}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-stone-900">{info.name}</h3>
        {over && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-400">
            <TriangleAlert size={12} /> More screens than allowed
          </span>
        )}
      </header>
      <LimitMeter active={active} max={max} />
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
        {info.devices.map((d, i) => (
          <DeviceTile key={d.id} name={d.name} type={d.type} state={devices[i]?.state ?? 'IDLE'} song={devices[i]?.song} retries={devices[i]?.retries} />
        ))}
      </div>
    </section>
  );
}
