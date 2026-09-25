import { createPortal } from 'react-dom';
import { Hand, Repeat, Sparkles, Microscope } from 'lucide-react';
import { FeatureTour, type TourStep } from './watermelon/feature-tour';

const KEY = 'playsync-tour-devices';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const remember = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };

const STEPS: TourStep[] = [
  { id: 'play', title: 'Tap Play on any screen', description: 'Each card is a pretend device on your account. Press Play on the MacBook to start some music.', icon: <Hand size={40} /> },
  { id: 'second', title: 'Now try a second one', description: 'Press Play on the iPhone. It will ask if you want the music moved over.', icon: <Repeat size={40} /> },
  { id: 'hop', title: 'Watch the hop', description: 'Say yes and the first screen stops instantly and tells you where the music went.', icon: <Sparkles size={40} /> },
  { id: 'nerds', title: 'Curious what happened?', description: 'Stats for nerds shows every request and database check behind the scenes.', icon: <Microscope size={40} /> },
];

export const tourSeen = seen;

/** Controlled tour overlay (portal). The page decides when it opens; closing remembers it. */
export function DevicesTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[65] grid place-items-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
      <FeatureTour steps={STEPS} onClose={() => { remember(); onClose(); }} closeOnBackdrop />
    </div>,
    document.body,
  );
}
