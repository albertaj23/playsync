import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx?|css)$/.test(f) && !f.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const src = walk(join(__dirname, '..'));

describe('source guards', () => {
  it("never animates the page wrapper with enterUp (it leaves a transform that breaks position:fixed)", () => {
    for (const f of src) expect(readFileSync(f, 'utf8'), f).not.toMatch(/enterUp\(\s*['"]\.page-content/);
  });
  it('geo/home scenes never start hidden via utils.set opacity: 0', () => {
    for (const f of src.filter((x) => /components\/(geo|home)\//.test(x))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/utils\.set\([^)]*opacity:\s*0/s);
    }
  });

  it('friendly pages use no jargon in string literals', () => {
    const friendly = src.filter((x) => /pages\/(devices|stress)\/|components\/(home|sim)\/|pages\/HomePage/.test(x) && x.endsWith('.tsx'));
    const banned = /\b(lease|heartbeat|409|410|fencing|deadlock|write skew|transaction id)\b/i;
    for (const f of friendly) {
      const lits = readFileSync(f, 'utf8').match(/(['"`])(?:(?!\1)[^\n\\])*\1/g) ?? [];
      for (const l of lits) {
        if (/^['"`](\/|\.|@|[a-z]+:)/.test(l) || /\/api|import|tab=/.test(l)) continue;
        expect(l, f).not.toMatch(banned);
      }
    }
  });
});

