import { Link } from 'react-router-dom';
import { FlaskConical, Smartphone } from 'lucide-react';
import CopyConfirm from '../../components/watermelon/copy-confirm';

export function MoreChapter({ username, onTour }: { username: string; onTour: () => void }) {
  const url = `${window.location.origin}/device?account=${encodeURIComponent(username)}&device=iPhone`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Link to="/nerds?tab=trace" className="glass-card group rounded-3xl p-6 transition-all hover:-translate-y-1">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/15 text-sky-400"><FlaskConical size={24} /></span>
        <h3 className="mt-4 text-lg font-semibold text-stone-900">See what the database saw →</h3>
        <p className="mt-1 text-sm text-stone-500">Every request you made, and the checks that ran after each one.</p>
      </Link>
      <div className="glass-card rounded-3xl p-6">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-400"><Smartphone size={24} /></span>
        <h3 className="mt-4 text-lg font-semibold text-stone-900">Use your real phone</h3>
        <p className="mt-1 break-all text-sm text-stone-500">On the same Wi-Fi, open <span className="font-mono text-xs">{url}</span></p>
        <div className="mt-3"><CopyConfirm title="Phone link" valueToCopy={url} showSettings={false} /></div>
        <button onClick={onTour} className="mt-4 text-sm font-semibold text-violet-400 hover:underline">Take the tour again</button>
      </div>
    </div>
  );
}
