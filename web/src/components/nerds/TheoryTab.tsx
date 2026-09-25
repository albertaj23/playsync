import { useMemo, useState } from 'react';
import { precedenceGraph, type Precedence } from '../../lib/theory/precedence';
import { fmt, parseSchedule } from '../../lib/theory/schedule';
import { timestampOrdering, type ToResult } from '../../lib/theory/timestampOrdering';
import { Badge, Card, cx, inputCls } from '../ui';

const EXAMPLES = [
  { label: 'Write skew (our NAIVE race)', text: 'R1(P) R2(P) W1(P) W2(P)' },
  { label: 'Lost update', text: 'R1(C) R2(C) W1(C) W2(C)' },
  { label: 'Serializable', text: 'R1(A) W1(A) R2(A) W2(B) R3(B)' },
  { label: 'Thomas write rule', text: 'W1(A) W2(A) W1(A)' },
  { label: 'TO abort', text: 'R1(A) W2(A) W1(A)' },
];

function Graph({ g }: { g: Precedence }) {
  const n = g.txns.length;
  const pos = new Map(g.txns.map((t, i) => [t, { x: 110 + 80 * Math.cos((i / n) * 2 * Math.PI - Math.PI / 2), y: 90 + 62 * Math.sin((i / n) * 2 * Math.PI - Math.PI / 2) }]));
  const inCycle = new Set(g.cycle ? g.cycle.slice(0, -1).map((x, i) => `${x}>${g.cycle![i + 1]}`) : []);
  return (
    <svg viewBox="0 0 220 180" className="mx-auto h-56 w-full max-w-xs" role="img" aria-label="Precedence graph">
      <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
      {g.edges.map((e) => {
        const a = pos.get(e.from)!, b = pos.get(e.to)!;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const bend = g.edges.some((o) => o.from === e.to && o.to === e.from) ? 14 : 0;
        const mx = (a.x + b.x) / 2 - (dy / len) * bend, my = (a.y + b.y) / 2 + (dx / len) * bend;
        const hot = inCycle.has(`${e.from}>${e.to}`);
        const sx = a.x + (dx / len) * 16, sy = a.y + (dy / len) * 16, ex = b.x - (dx / len) * 18, ey = b.y - (dy / len) * 18;
        return <path key={`${e.from}${e.to}`} d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`} fill="none" strokeWidth="2" markerEnd="url(#arr)" className={hot ? 'text-rose-400' : 'text-stone-500'} stroke="currentColor" />;
      })}
      {g.txns.map((t) => (
        <g key={t}><circle cx={pos.get(t)!.x} cy={pos.get(t)!.y} r="15" fill="var(--surface)" stroke="var(--c-brand-400)" strokeWidth="2" />
          <text x={pos.get(t)!.x} y={pos.get(t)!.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--s900)">T{t}</text></g>
      ))}
    </svg>
  );
}

function ToTable({ r, title }: { r: ToResult; title: string }) {
  const tone = { ok: 'text-emerald-400', abort: 'text-rose-400', ignored: 'text-amber-400', skipped: 'text-stone-400' } as const;
  return (
    <div>
      <h4 className="mb-1 font-mono text-sm font-semibold text-stone-800">{title}</h4>
      <div className="overflow-auto rounded-xl border border-fg/10">
        <table className="w-full font-mono text-xs">
          <tbody>{r.steps.map((s) => (
            <tr key={s.op.i} className="border-t border-fg/8 first:border-0">
              <td className="px-2 py-1.5 font-semibold text-stone-900">{fmt(s.op)}</td>
              <td className={cx('px-2 py-1.5 font-semibold', tone[s.verdict])}>{s.verdict.toUpperCase()}</td>
              <td className="px-2 py-1.5 text-stone-500">{s.reason}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-1 font-mono text-xs text-stone-500">timestamps {Object.entries(r.ts).map(([t, v]) => `TS(T${t})=${v}`).join(', ')} · aborted: {r.aborted.length ? r.aborted.map((t) => `T${t}`).join(', ') : 'none'}{r.ignoredWrites ? ` · ignored writes: ${r.ignoredWrites}` : ''}</p>
    </div>
  );
}

/** Stretch goals: a precedence-graph / conflict-serializability checker and a timestamp-ordering simulator. */
export function TheoryTab() {
  const [text, setText] = useState(EXAMPLES[0]!.text);
  const parsed = useMemo(() => { try { return { ops: parseSchedule(text), error: null }; } catch (e) { return { ops: null, error: (e as Error).message }; } }, [text]);
  const g = parsed.ops ? precedenceGraph(parsed.ops) : null;
  const basic = parsed.ops ? timestampOrdering(parsed.ops, false) : null;
  const thomas = parsed.ops ? timestampOrdering(parsed.ops, true) : null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-stone-600">
        Type a schedule and see whether it is <strong>conflict-serializable</strong> (precedence graph), and what <strong>timestamp ordering</strong> would do to it, with and without the Thomas write rule.
        This is a <em>simulation</em>: MySQL/InnoDB uses locking and MVCC, not timestamp ordering.
      </p>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((e) => <button key={e.label} onClick={() => setText(e.text)} className="rounded-full bg-fg/6 px-3 py-1 font-mono text-xs text-stone-600 ring-1 ring-fg/10 hover:bg-fg/10">{e.label}</button>)}
      </div>
      <input className={cx(inputCls, 'font-mono')} value={text} onChange={(e) => setText(e.target.value)} aria-label="Schedule" spellCheck={false} />
      {parsed.error && <p className="font-mono text-sm text-rose-400">{parsed.error}</p>}
      {g && basic && thomas && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Conflict-serializability" subtitle="edge Ti → Tj when an op of Ti conflicts with a later op of Tj">
            <div className="space-y-3">
              <Graph g={g} />
              <div>
                {g.cycle
                  ? <Badge tone="red">not serializable: cycle {g.cycle.map((t) => `T${t}`).join(' → ')}</Badge>
                  : <Badge tone="green">conflict-serializable: equivalent serial order {g.serialOrder!.map((t) => `T${t}`).join(' → ')}</Badge>}
              </div>
              <ul className="font-mono text-xs text-stone-500">{g.edges.map((e) => <li key={`${e.from}${e.to}`}>T{e.from} → T{e.to}: {e.via.join('; ')}</li>)}</ul>
            </div>
          </Card>
          <Card title="Timestamp ordering" subtitle="TS(Ti) = order of the first operation of Ti">
            <div className="space-y-4"><ToTable r={basic} title="Basic TO" /><ToTable r={thomas} title="With the Thomas write rule" /></div>
          </Card>
        </div>
      )}
    </div>
  );
}
