import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portal tooltip for the icon rail: 400 ms delay on hover, immediate on keyboard focus. */
export function Tooltip({ label, enabled, children }: { label: string; enabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = (delay: number) => {
    if (!enabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ x: r.right + 10, y: r.top + r.height / 2 });
    }, delay);
  };
  const hide = () => { window.clearTimeout(timer.current); setPos(null); };
  return (
    <div ref={ref} onMouseEnter={() => show(400)} onMouseLeave={hide} onFocus={() => show(0)} onBlur={hide}>
      {children}
      {pos && createPortal(
        <div role="tooltip" style={{ left: pos.x, top: pos.y }}
          className="pointer-events-none fixed z-[80] -translate-y-1/2 rounded-lg bg-stone-950 px-2.5 py-1 text-xs font-semibold text-[var(--bg)] shadow-lg reveal">
          {label}
        </div>,
        document.body,
      )}
    </div>
  );
}
