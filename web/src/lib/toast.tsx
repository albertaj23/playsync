import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type Kind = 'good' | 'info' | 'warn';
interface T { id: number; kind: Kind; text: string }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => undefined);
let next = 1;

const style: Record<Kind, string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  info: 'border-sky-500/40 text-sky-400',
  warn: 'border-amber-500/40 text-amber-400',
};
const icon = { good: CheckCircle2, info: Info, warn: TriangleAlert } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id));
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = next++;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = icon[t.kind];
            return (
              <motion.div
                key={t.id} layout
                initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className={`surface pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg ${style[t.kind]}`}
              >
                <Icon size={18} className="shrink-0" />
                <span className="text-stone-800">{t.text}</span>
                <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="ml-1 text-stone-500 hover:text-stone-800"><X size={14} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
