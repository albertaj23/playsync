export interface Op { i: number; txn: number; kind: 'R' | 'W'; item: string }

/** Parses "R1(A) W2(A) W1(A)" (case-insensitive; commas/semicolons/spaces separate). Throws a readable Error. */
export function parseSchedule(text: string): Op[] {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) throw new Error('Type a schedule such as R1(A) W2(A) W1(A)');
  return parts.map((p, i) => {
    const m = /^([rw])(\d+)\(([a-z][a-z0-9_]*)\)$/i.exec(p);
    if (!m) throw new Error(`Can't read "${p}". Use R1(A) or W2(B): R/W, the transaction number, then the item in brackets.`);
    return { i, kind: m[1]!.toUpperCase() as 'R' | 'W', txn: Number(m[2]), item: m[3]!.toUpperCase() };
  });
}

export const fmt = (o: Op) => `${o.kind}${o.txn}(${o.item})`;
