import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Headphones } from 'lucide-react';
import { Button } from '../ui';

/** "Play here instead?" as a bottom sheet on phones and a centred card on larger screens. */
export function AskSheet({ open, title, body, busy, onConfirm, onCancel }: {
  open: boolean; title: string; body?: string; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="ask" className="fixed inset-0 z-[62] flex items-end justify-center bg-black/35 p-4 backdrop-blur-[2px] sm:items-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}
        >
          <motion.div
            role="dialog" aria-label={title}
            initial={{ y: 80, scale: 0.96, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="surface w-full max-w-sm rounded-3xl border border-fg/10 p-6 text-center shadow-2xl"
          >
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/15 text-violet-400"><Headphones size={28} /></div>
            <h3 className="mt-4 font-display text-xl font-semibold text-stone-900">{title}</h3>
            {body && <p className="mt-1.5 text-sm text-stone-500">{body}</p>}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <Button variant="primary" size="lg" className="flex-1" onClick={onConfirm} disabled={busy}>Play here</Button>
              <Button variant="ghost" size="lg" className="flex-1" onClick={onCancel} disabled={busy}>Never mind</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
