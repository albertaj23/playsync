/**
 * A ring around the household count: sealed green while everyone is within their limit, and it
 * cracks into red shards (one per household over the limit, up to 12) when limits break. Re-seals
 * when repaired. Pure SVG + CSS transitions.
 */
export function BreachMeter({ violating }: { violating: number }) {
  const shards = Math.min(12, violating);
  const broken = violating > 0;
  return (
    <svg viewBox="0 0 120 120" className="h-24 w-24 shrink-0 overflow-visible" role="img" aria-label={broken ? `${violating} households over their limit` : 'Everyone within their limit'}>
      <circle cx="60" cy="60" r="46" fill="none" strokeWidth="8" strokeLinecap="round"
        stroke={broken ? '#f43f5e' : '#34d399'} strokeDasharray={broken ? '14 9' : '289'} style={{ transition: 'stroke 0.4s, stroke-dasharray 0.6s' }} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const on = i < shards;
        return <polygon key={i} points="0,-9 6,7 -6,6" fill="#f43f5e" transform={`translate(${60 + Math.cos(a) * 62} ${60 + Math.sin(a) * 62}) rotate(${(a * 180) / Math.PI + 90})`}
          style={{ opacity: on ? 1 : 0, transition: 'opacity 0.3s' }} />;
      })}
    </svg>
  );
}
