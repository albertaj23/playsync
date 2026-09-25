// Shared geometric vocabulary (see phase-nav-ux.md section 6.1). Every piece is drawn around the
// centre (200,200) of a 400x400 viewBox so scenes can translate/rotate them freely.
export const SAT_COLORS = ['#34d399', '#38bdf8', '#fbbf24', '#a78bfa'];

/** A device: laptop, phone, tablet or browser (circle), with a white "screen" dot. */
export function DeviceShape({ kind, color }: { kind: number; color?: string }) {
  const c = color ?? SAT_COLORS[kind % 4]!;
  return (
    <>
      {kind % 4 === 0 && <rect x="170" y="180" width="60" height="40" rx="8" fill={c} />}
      {kind % 4 === 1 && <rect x="182" y="168" width="36" height="64" rx="10" fill={c} />}
      {kind % 4 === 2 && <rect x="166" y="176" width="68" height="48" rx="12" fill={c} />}
      {kind % 4 === 3 && <circle cx="200" cy="200" r="28" fill={c} />}
      <circle cx="200" cy="200" r="4" fill="#fff" opacity="0.85" />
    </>
  );
}

/** The account / Melo: half-disc with rind, flesh and seeds. Face is drawn by the caller. */
export function Slice() {
  return (
    <>
      <path d="M55 215 A145 145 0 0 0 345 215 Z" fill="#22c55e" />
      <path d="M68 215 A132 132 0 0 0 332 215 Z" fill="#dcfce7" />
      <path d="M76 215 A124 124 0 0 0 324 215 Z" fill="#ff5c7a" />
      {[[150, 232], [200, 226], [250, 232], [175, 322], [225, 322]].map(([x, y], i) => (
        <polygon key={i} points={`${x},${y! - 7} ${x! + 5},${y! + 6} ${x! - 5},${y! + 6}`} fill="#3b1d2a" opacity="0.75" />
      ))}
    </>
  );
}

/** Protection held: a stroke circle that scenes draw with strokeDashoffset len -> 0. */
export function Ring({ r = 170, color = '#34d399' }: { r?: number; color?: string }) {
  const len = Math.round(2 * Math.PI * r);
  return <circle className="ring" cx="200" cy="200" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len} transform="rotate(-90 200 200)" />;
}

/** Ambient triangles and dots (decoration layer). */
export function Bits() {
  return (
    <>
      {[[60, 70, 12], [340, 90, 9], [40, 300, 8], [360, 320, 11], [200, 30, 7], [120, 370, 6]].map(([x, y, s], i) => (
        <g key={i} className="bit" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          {i % 2 ? <polygon points={`${x},${y! - s!} ${x! + s!},${y! + s!} ${x! - s!},${y! + s!}`} fill={SAT_COLORS[i % 4]} opacity="0.8" /> : <circle cx={x} cy={y} r={s! * 0.6} fill={SAT_COLORS[i % 4]} opacity="0.8" />}
        </g>
      ))}
    </>
  );
}

/** N small circles in rows: people or presses. */
export function Crowd({ n = 30, cols = 10 }: { n?: number; cols?: number }) {
  return (
    <g className="crowd">
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} cx={60 + (i % cols) * 20} cy={140 + Math.floor(i / cols) * 20} r="7" fill={SAT_COLORS[i % 4]} opacity="0.9" />
      ))}
    </g>
  );
}

/** The limit: two pillars and a bar with `slots` openings. */
export function Gate({ slots = 1 }: { slots?: number }) {
  const w = 240, x0 = 80, slotW = w / (slots + 1);
  return (
    <g className="gate" fill="var(--s500)">
      <rect x={x0 - 12} y="120" width="12" height="160" rx="4" />
      <rect x={x0 + w} y="120" width="12" height="160" rx="4" />
      {Array.from({ length: slots + 1 }, (_, i) => <rect key={i} x={x0 + i * slotW + (i ? 14 : 0)} y="120" width={slotW - 14} height="14" rx="6" />)}
    </g>
  );
}

/** Protection broken: jagged shards. */
export function Crack({ shards = 6 }: { shards?: number }) {
  return (
    <g className="crack" fill="#f43f5e">
      {Array.from({ length: shards }, (_, i) => {
        const a = (i / shards) * Math.PI * 2, x = 200 + Math.cos(a) * 90, y = 200 + Math.sin(a) * 90;
        return <polygon key={i} points={`${x},${y - 14} ${x + 10},${y + 10} ${x - 12},${y + 8}`} />;
      })}
    </g>
  );
}

/** A stack of blocks: the play counter. */
export function Counter({ blocks = 5 }: { blocks?: number }) {
  return (
    <g className="counter">
      {Array.from({ length: blocks }, (_, i) => <rect key={i} x="150" y={300 - i * 26} width="100" height="22" rx="6" fill={SAT_COLORS[i % 4]} />)}
    </g>
  );
}
