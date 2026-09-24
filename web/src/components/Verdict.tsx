import { useEffect, useRef } from 'react';
import { celebrate, pop, shake } from '../lib/motion';
import { Mascot } from './Mascot';
import { cx } from './ui';

/** Friendly result banner: confetti when the protection held, a gentle shake when it didn't. */
export function Verdict({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  const box = useRef<HTMLDivElement>(null);
  const mascot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pop(mascot.current);
    if (ok) celebrate(mascot.current); else shake(box.current);
  }, [ok, title]);
  return (
    <div ref={box} className={cx('flex items-center gap-4 rounded-2xl p-4', ok ? 'bg-emerald-500/10' : 'bg-rose-500/10')}>
      <div ref={mascot} className="shrink-0"><Mascot mood={ok ? 'cheer' : 'worried'} size={72} /></div>
      <div>
        <div className={cx('font-display text-lg font-semibold', ok ? 'text-emerald-400' : 'text-rose-400')}>{title}</div>
        <p className={cx('mt-1 text-sm', ok ? 'text-emerald-400' : 'text-rose-400')}>{body}</p>
      </div>
    </div>
  );
}
