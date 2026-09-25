import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, Moon, Search, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSidebar } from '../../lib/shell';
import { useTheme } from '../../lib/theme';
import { PhoneButton } from './PhonePopover';

/** Phone "More" sheet (portal). Closes on Esc, scrim tap or navigation. */
export function MoreSheet() {
  const { moreOpen, setMoreOpen, setSearchOpen, width } = useSidebar();
  const { theme, toggle } = useTheme();
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen, setMoreOpen]);
  if (!moreOpen || width >= 768) return null;
  const row = 'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-base font-semibold text-stone-800 hover:bg-fg/6';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end bg-black/35 backdrop-blur-[2px]" onClick={() => setMoreOpen(false)}>
      <div role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()}
        className="surface sheet-up w-full rounded-t-3xl border-t border-fg/10 p-3 pb-[calc(var(--safe-bottom)+1rem)] shadow-2xl">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-fg/20" aria-hidden />
        <Link to="/nerds" className={row} onClick={() => setMoreOpen(false)}><FlaskConical size={20} /> Stats for nerds</Link>
        <button className={row} onClick={() => { setMoreOpen(false); setSearchOpen(true); }}><Search size={20} /> Search</button>
        <PhoneButton className="!px-4 !py-3 !text-base !text-stone-800" />
        <button className={row} onClick={toggle}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
      </div>
    </div>,
    document.body,
  );
}
