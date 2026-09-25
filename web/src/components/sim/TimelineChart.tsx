import type { Marker, SeriesPoint } from '../../lib/sim';

const W = 640;
const H = 84;

function Line({ points, get, color, label, unit }: { points: SeriesPoint[]; get: (p: SeriesPoint) => number; color: string; label: string; unit: string }) {
  const max = Math.max(1, ...points.map(get));
  const tMax = Math.max(1, ...points.map((p) => p.t));
  const x = (t: number) => (t / tMax) * W;
  const y = (v: number) => H - 6 - (v / max) * (H - 16);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-stone-700">{label}</span><span className="font-mono text-stone-400">peak {Math.round(max)}{unit}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label={`${label} over time`}>
        <line x1="0" y1={H - 6} x2={W} y2={H - 6} stroke="var(--chart-grid)" />
        {points.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

/** Three small charts sharing one time axis, with a labelled vertical marker at every live change. */
export function TimelineChart({ series, markers }: { series: SeriesPoint[]; markers: Marker[] }) {
  const tMax = Math.max(1, ...series.map((p) => p.t));
  return (
    <div className="relative space-y-4">
      <Line points={series} get={(p) => p.playsPerSec} color="#34d399" label="Songs started per second" unit="" />
      <Line points={series} get={(p) => p.p95Ms} color="#38bdf8" label="Time to start playing (slowest 5%)" unit=" ms" />
      <Line points={series} get={(p) => p.violating} color="#f43f5e" label="Households over their limit" unit="" />
      {markers.filter((m) => m.tMs > 0).map((m) => (
        <div key={m.tMs} className="pointer-events-none absolute inset-y-0" style={{ left: `${Math.min(100, (m.tMs / 1000 / tMax) * 100)}%` }}>
          <div className="h-full w-px bg-violet-500/60" />
          <span className="absolute left-1 top-0 max-w-40 rounded-lg bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400">{m.label}</span>
        </div>
      ))}
    </div>
  );
}
