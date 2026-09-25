import { describe, expect, it } from 'vitest';
import { precedenceGraph } from './precedence';
import { parseSchedule } from './schedule';
import { timestampOrdering } from './timestampOrdering';

const p = (s: string) => parseSchedule(s);

describe('parseSchedule', () => {
  it('parses ops case-insensitively and explains errors', () => {
    expect(p('r1(a) W2(A)').map((o) => `${o.kind}${o.txn}${o.item}`)).toEqual(['R1A', 'W2A']);
    expect(() => p('R1(A) X2(A)')).toThrow(/Can't read "X2\(A\)"/);
    expect(() => p('   ')).toThrow();
  });
});

describe('precedenceGraph', () => {
  it('the NAIVE write-skew schedule has a cycle and no serial order', () => {
    const g = precedenceGraph(p('R1(P) R2(P) W1(P) W2(P)'));
    expect(g.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['1>2', '2>1']);
    expect(g.cycle).not.toBeNull();
    expect(g.serialOrder).toBeNull();
  });
  it('a serializable schedule yields a serial order', () => {
    const g = precedenceGraph(p('R1(A) W1(A) R2(A) W2(B) R3(B)'));
    expect(g.cycle).toBeNull();
    expect(g.serialOrder).toEqual([1, 2, 3]);
  });
  it('reads never conflict with reads', () => {
    expect(precedenceGraph(p('R1(A) R2(A) R1(A)')).edges).toEqual([]);
  });
});

describe('timestampOrdering', () => {
  it('basic TO aborts the older writer that arrives after a younger one wrote', () => {
    const r = timestampOrdering(p('R1(A) W2(A) W1(A)'), false);
    expect(r.ts).toEqual({ 1: 1, 2: 2 });
    expect(r.aborted).toEqual([1]);
    expect(r.steps[2]!.verdict).toBe('abort');
  });
  it('the Thomas write rule ignores the obsolete write instead of aborting', () => {
    const r = timestampOrdering(p('W1(A) W2(A) W1(A)'), true);
    expect(r.aborted).toEqual([]);
    expect(r.ignoredWrites).toBe(1);
  });
  it('a read of a value from the future aborts, and later ops of that txn are skipped', () => {
    const r = timestampOrdering(p('R1(B) W2(A) R1(A) W1(B)'), false);
    expect(r.aborted).toEqual([1]);
    expect(r.steps[3]!.verdict).toBe('skipped');
  });
});
