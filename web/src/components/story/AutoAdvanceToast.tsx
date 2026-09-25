import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import { reduced } from '../../lib/motion';

/** "Jumped to your result · Back to setup". Auto-dismisses after 5 s. */
export function AutoAdvanceToast({ toast, onDone }: { toast: { y: number; label: string } | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDone, 5000);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--topbar-h)+12px)] z-[55] flex justify-center px-4 md:pl-[var(--sidebar-w)]" role="status">
      <div className="reveal surface pointer-events-auto flex items-center gap-3 rounded-full border border-fg/10 py-1.5 pl-4 pr-1.5 text-sm shadow-lg">
        <span className="font-medium text-stone-700">Jumped to your result</span>
        <button onClick={() => { window.scrollTo({ top: toast.y, behavior: reduced() ? 'auto' : 'smooth' }); onDone(); }}
          className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-3 py-1 font-semibold text-violet-400 hover:bg-violet-500/20">
          <ArrowUp size={14} /> Back to {toast.label}
        </button>
      </div>
    </div>,
    document.body,
  );
}
