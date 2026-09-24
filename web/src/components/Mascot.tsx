export type Mood = 'happy' | 'cheer' | 'worried' | 'sleepy' | 'wow';

/** Melo, the watermelon-slice mascot. Pure inline SVG; mood changes the face only. */
export function Mascot({ mood = 'happy', size = 96, className = '' }: { mood?: Mood; size?: number; className?: string }) {
  const mouth = {
    happy: 'M40 66 Q50 76 60 66',
    cheer: 'M38 64 Q50 84 62 64 Z',
    worried: 'M41 72 Q50 64 59 72',
    sleepy: 'M43 69 Q50 72 57 69',
    wow: 'M50 66 m-5 0 a5 6 0 1 0 10 0 a5 6 0 1 0 -10 0',
  }[mood];
  const closed = mood === 'sleepy';
  return (
    <svg viewBox="0 0 100 80" width={size} height={size * 0.8} className={className} role="img" aria-label="Melo the watermelon">
      <path d="M6 30 A44 44 0 0 0 94 30 Z" fill="#22c55e" />
      <path d="M11 30 A39 39 0 0 0 89 30 Z" fill="#dcfce7" />
      <path d="M15 30 A35 35 0 0 0 85 30 Z" fill="#ff5c7a" />
      <ellipse cx="30" cy="46" rx="2" ry="3.2" fill="#3b1d2a" transform="rotate(-20 30 46)" />
      <ellipse cx="70" cy="46" rx="2" ry="3.2" fill="#3b1d2a" transform="rotate(20 70 46)" />
      <ellipse cx="50" cy="52" rx="1.8" ry="2.8" fill="#3b1d2a" opacity="0.0" />
      {closed ? (
        <>
          <path d="M33 53 Q38 57 43 53" stroke="#3b1d2a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M57 53 Q62 57 67 53" stroke="#3b1d2a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <g className="blink">
          <ellipse cx="38" cy="52" rx={mood === 'wow' ? 4.4 : 3.4} ry={mood === 'wow' ? 5.2 : 4.2} fill="#3b1d2a" />
          <ellipse cx="62" cy="52" rx={mood === 'wow' ? 4.4 : 3.4} ry={mood === 'wow' ? 5.2 : 4.2} fill="#3b1d2a" />
          <circle cx="39.2" cy="50.6" r="1.2" fill="#fff" />
          <circle cx="63.2" cy="50.6" r="1.2" fill="#fff" />
        </g>
      )}
      <path d={mouth} stroke="#3b1d2a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill={mood === 'cheer' || mood === 'wow' ? '#7f1d3a' : 'none'} />
      <circle cx="27" cy="62" r="4.5" fill="#ff8fa3" opacity="0.7" />
      <circle cx="73" cy="62" r="4.5" fill="#ff8fa3" opacity="0.7" />
      {mood === 'worried' && <path d="M78 34 q3 5 0 8 q-3 -3 0 -8z" fill="#7dd3fc" />}
      {mood === 'sleepy' && (
        <g className="floatz" fill="#a78bfa" fontSize="11" fontWeight="700" fontFamily="Fredoka, sans-serif"><text x="74" y="30">z</text></g>
      )}
    </svg>
  );
}
