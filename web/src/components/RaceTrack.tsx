import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { reduced } from '../lib/motion';
import { Badge, cx } from './ui';

export interface Lane {
  key: string;
  label: string;
  state: 'waiting' | 'running' | 'done';
  ok?: boolean;
  detail?: string;
  badge?: string;
}

function LaneRow({ lane }: { lane: Lane }) {
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fill.current;
    if (!el) return;
    if (lane.state === 'done') {
      if (reduced()) el.style.width = '100%';
      else animate(el, { width: ['0%', '100%'], duration: 650, ease: 'outCubic' });
    }
  }, [lane.state]);
  const Icon = lane.state === 'done' ? (lane.ok ? CheckCircle2 : XCircle) : CircleDashed;
  const tone = lane.state !== 'done' ? 'text-stone-500' : lane.ok ? 'text-emerald-400' : 'text-rose-400';
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <Icon size={20} className={cx('shrink-0', tone, lane.state === 'running' && 'animate-spin')} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-stone-900">{lane.label}</div>
          <div className="text-xs text-stone-500">{lane.state === 'done' ? lane.detail : lane.state === 'running' ? 'Running right now…' : 'Waiting for its turn'}</div>
        </div>
        {lane.state === 'done' && lane.badge && <Badge tone={lane.ok ? 'green' : 'red'}>{lane.badge}</Badge>}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-fg/8">
        <div
          ref={fill}
          className={cx('h-full rounded-full', lane.state === 'done' ? (lane.ok ? 'bg-emerald-500' : 'bg-rose-500') : 'bg-violet-500/60', lane.state === 'running' && 'w-1/3 animate-pulse')}
          style={lane.state === 'done' ? { width: '100%' } : undefined}
        />
      </div>
    </li>
  );
}

/** The comparison as a race: each method gets a lane that fills in as its result arrives. */
export function RaceTrack({ lanes }: { lanes: Lane[] }) {
  return <ul className="divide-y divide-fg/8">{lanes.map((l) => <LaneRow key={l.key} lane={l} />)}</ul>;
}
