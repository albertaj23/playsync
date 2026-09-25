import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone } from 'lucide-react';
import CopyConfirm from '../watermelon/copy-confirm';
import { cx } from '../ui';

const phoneUrl = () => `${window.location.origin}/device?account=brij&device=iPhone`;

/** "Use your phone": the link to open on a real phone (same Wi-Fi) with a copy button. */
export function PhoneButton({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-stone-600 transition-colors hover:bg-fg/6 hover:text-stone-900', collapsed && 'justify-center', className)}>
        <Smartphone size={20} className="shrink-0" />
        {!collapsed ? <span>Use your phone</span> : <span className="sr-only">Use your phone</span>}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Use your phone"
            className="surface reveal fixed bottom-20 left-4 w-[min(92vw,22rem)] rounded-3xl border border-fg/10 p-5 shadow-2xl md:bottom-6 md:left-[calc(var(--sidebar-w)+12px)]">
            <h3 className="font-display text-lg font-semibold text-stone-900">Open this on your phone</h3>
            <p className="mt-1 text-sm text-stone-500">On the same Wi-Fi, open this link. Your phone becomes one of the devices.</p>
            <p className="mt-3 break-all rounded-xl bg-fg/6 px-3 py-2 font-mono text-xs text-stone-700">{phoneUrl()}</p>
            <div className="mt-3"><CopyConfirm title="Phone link" valueToCopy={phoneUrl()} showSettings={false} /></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
