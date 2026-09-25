import { SAT_COLORS } from './pieces';

export type GlyphName = 'slice' | 'device' | 'crowd' | 'gate' | 'ring' | 'counter' | 'spark';

/** 16 px mini shapes for the chapter rail. */
export function Glyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden fill="currentColor">
      {name === 'slice' && <path d="M1 7 A7 7 0 0 0 15 7 Z" />}
      {name === 'device' && <rect x="3" y="2" width="10" height="12" rx="3" />}
      {name === 'crowd' && <>{[3, 8, 13].map((x, i) => <circle key={x} cx={x} cy={i % 2 ? 10 : 6} r="2.2" fill={SAT_COLORS[i]} />)}</>}
      {name === 'gate' && <path d="M2 14V3h2v11zM12 14V3h2v11zM2 3h12v2H2z" />}
      {name === 'ring' && <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />}
      {name === 'counter' && <><rect x="4" y="2" width="8" height="3" rx="1" /><rect x="4" y="6.5" width="8" height="3" rx="1" /><rect x="4" y="11" width="8" height="3" rx="1" /></>}
      {name === 'spark' && <polygon points="8,1 10,6 15,8 10,10 8,15 6,10 1,8 6,6" />}
    </svg>
  );
}
