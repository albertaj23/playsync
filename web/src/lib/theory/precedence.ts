import type { Op } from './schedule';

export interface Edge { from: number; to: number; via: string[] }
export interface Precedence { txns: number[]; edges: Edge[]; cycle: number[] | null; serialOrder: number[] | null }

const conflicts = (a: Op, b: Op) => a.txn !== b.txn && a.item === b.item && (a.kind === 'W' || b.kind === 'W');

/** Precedence (serialization) graph: Ti -> Tj when an op of Ti conflicts with a LATER op of Tj. */
export function precedenceGraph(ops: Op[]): Precedence {
  const txns = [...new Set(ops.map((o) => o.txn))].sort((a, b) => a - b);
  const map = new Map<string, Edge>();
  for (let x = 0; x < ops.length; x++) {
    for (let y = x + 1; y < ops.length; y++) {
      const a = ops[x]!, b = ops[y]!;
      if (!conflicts(a, b)) continue;
      const key = `${a.txn}>${b.txn}`;
      const e = map.get(key) ?? { from: a.txn, to: b.txn, via: [] };
      const why = `${a.kind}${a.txn}(${a.item}) before ${b.kind}${b.txn}(${b.item})`;
      if (!e.via.includes(why)) e.via.push(why);
      map.set(key, e);
    }
  }
  const edges = [...map.values()];
  const cycle = findCycle(txns, edges);
  return { txns, edges, cycle, serialOrder: cycle ? null : topoOrder(txns, edges) };
}

function findCycle(nodes: number[], edges: Edge[]): number[] | null {
  const adj = new Map<number, number[]>(nodes.map((n) => [n, []]));
  for (const e of edges) adj.get(e.from)!.push(e.to);
  const state = new Map<number, 0 | 1 | 2>();
  const stack: number[] = [];
  const dfs = (n: number): number[] | null => {
    state.set(n, 1); stack.push(n);
    for (const m of adj.get(n)!) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state.get(m)) { const c = dfs(m); if (c) return c; }
    }
    state.set(n, 2); stack.pop();
    return null;
  };
  for (const n of nodes) if (!state.get(n)) { const c = dfs(n); if (c) return c; }
  return null;
}

function topoOrder(nodes: number[], edges: Edge[]): number[] {
  const indeg = new Map<number, number>(nodes.map((n) => [n, 0]));
  for (const e of edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  const out: number[] = [];
  const ready = nodes.filter((n) => indeg.get(n) === 0);
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n);
    for (const e of edges) if (e.from === n) { indeg.set(e.to, indeg.get(e.to)! - 1); if (indeg.get(e.to) === 0) ready.push(e.to); }
  }
  return out;
}
