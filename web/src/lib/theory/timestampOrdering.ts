import type { Op } from './schedule';

export type Verdict = 'ok' | 'abort' | 'ignored' | 'skipped';
export interface ToStep { op: Op; verdict: Verdict; reason: string; rts: number; wts: number }
export interface ToResult { ts: Record<number, number>; steps: ToStep[]; aborted: number[]; ignoredWrites: number }

/**
 * Basic timestamp ordering (optionally with the Thomas write rule). TS(Ti) = order of Ti's first
 * operation. R_i(x): abort if TS(i) < WTS(x). W_i(x): abort if TS(i) < RTS(x); if TS(i) < WTS(x)
 * abort (basic) or ignore the obsolete write (Thomas). A simulation: MySQL/InnoDB does not use TO.
 */
export function timestampOrdering(ops: Op[], thomas: boolean): ToResult {
  const ts: Record<number, number> = {};
  for (const o of ops) if (ts[o.txn] === undefined) ts[o.txn] = Object.keys(ts).length + 1;
  const rts = new Map<string, number>(), wts = new Map<string, number>();
  const dead = new Set<number>();
  const steps: ToStep[] = [];
  let ignoredWrites = 0;
  for (const op of ops) {
    const r = rts.get(op.item) ?? 0, w = wts.get(op.item) ?? 0, t = ts[op.txn]!;
    const push = (verdict: Verdict, reason: string) => steps.push({ op, verdict, reason, rts: rts.get(op.item) ?? 0, wts: wts.get(op.item) ?? 0 });
    if (dead.has(op.txn)) { push('skipped', `T${op.txn} already aborted`); continue; }
    if (op.kind === 'R') {
      if (t < w) { dead.add(op.txn); push('abort', `TS(T${op.txn})=${t} < WTS(${op.item})=${w}: it would read a value from its future`); continue; }
      rts.set(op.item, Math.max(r, t)); push('ok', `RTS(${op.item}) = ${Math.max(r, t)}`);
    } else {
      if (t < r) { dead.add(op.txn); push('abort', `TS(T${op.txn})=${t} < RTS(${op.item})=${r}: a younger transaction already read the old value`); continue; }
      if (t < w) {
        if (thomas) { ignoredWrites++; push('ignored', `Thomas write rule: TS(T${op.txn})=${t} < WTS(${op.item})=${w}, the write is obsolete and skipped`); continue; }
        dead.add(op.txn); push('abort', `TS(T${op.txn})=${t} < WTS(${op.item})=${w}: a younger transaction already wrote it`); continue;
      }
      wts.set(op.item, t); push('ok', `WTS(${op.item}) = ${t}`);
    }
  }
  return { ts, steps, aborted: [...dead], ignoredWrites };
}
