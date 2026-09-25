import type { LostUpdateResult, LostUpdateVariant, RaceResult, StrategyName } from '../../lib/api';

export interface Method { name: string; label: string; idea: string; safe: boolean; glyph: string }

export const METHODS: (Method & { name: StrategyName })[] = [
  { name: 'NAIVE', label: 'No protection', idea: 'Check if the account is free, then start. Two devices can both check before either starts.', safe: false, glyph: '🚪' },
  { name: 'TXN_RR', label: 'Basic grouping', idea: 'Bundles the steps together, but each device still looks at an old picture of the account.', safe: false, glyph: '📦' },
  { name: 'SERIALIZABLE', label: 'Strictest mode', idea: 'The database refuses clashing requests outright; the losers try again.', safe: true, glyph: '🛑' },
  { name: 'PESSIMISTIC', label: 'Take a number', idea: 'Devices line up and go one at a time.', safe: true, glyph: '🎟️' },
  { name: 'OPTIMISTIC', label: 'Check at the end', idea: 'Everyone goes ahead; if something changed meanwhile, they start over.', safe: true, glyph: '🔍' },
  { name: 'CONSTRAINT', label: 'Built-in rule', idea: 'A database rule makes a second player impossible. Only works for a one-device limit.', safe: true, glyph: '🔢' },
  { name: 'TRIGGER', label: 'Database watchdog', idea: 'A watchdog inside the database counts players before each start. It catches almost every clash, but two starts can still slip past it together.', safe: false, glyph: '🐕' },
  { name: 'REDIS_LEASE', label: 'Ticket booth (Redis)', idea: 'A separate, very fast store hands out a limited number of tickets atomically. Quick and safe, but it has to stay in step with the database.', safe: true, glyph: '🎫' },
];

export const LOST_UPDATE_METHODS: (Method & { name: LostUpdateVariant })[] = [
  { name: 'NAIVE_RMW', label: 'Read, then write', idea: 'Each phone reads the number, adds one, writes it back. Two phones can read the same number.', safe: false, glyph: '📖' },
  { name: 'ATOMIC', label: 'Let the database add', idea: 'The database does the +1 itself, one at a time.', safe: true, glyph: '➕' },
  { name: 'LOCKED', label: 'Take a number', idea: 'Each phone waits its turn to read and write.', safe: true, glyph: '🎟️' },
  { name: 'CAS', label: 'Check it didn’t change', idea: 'Write only if the number is still what you read; otherwise try again.', safe: true, glyph: '🔍' },
];

export const labelOf = (n: StrategyName) => METHODS.find((m) => m.name === n)!.label;
export const luLabelOf = (n: LostUpdateVariant) => LOST_UPDATE_METHODS.find((m) => m.name === n)!.label;

export function verdict(r: RaceResult) {
  const limit = r.maxStreams * r.accounts;
  if (r.violations > 0) {
    return { ok: false, title: `Whoa, ${r.granted} screens got in but only ${limit} ${limit === 1 ? 'was' : 'were'} allowed. That's the bug we're hunting 🐛`,
      body: `${r.violations} screen${r.violations === 1 ? '' : 's'} slipped through that should have been turned away.` };
  }
  return { ok: true, title: `Nice! Only ${r.granted} screen${r.granted === 1 ? '' : 's'} got in, exactly as allowed 🎉`,
    body: `${r.rejected} politely waited their turn${r.errors ? `, and ${r.errors} gave up after retrying too many times` : ''}.` };
}

export function luVerdict(r: LostUpdateResult) {
  if (r.lost > 0) {
    return { ok: false, title: `${r.succeeded} people listened, but the counter only says ${r.finalCount} 😬`,
      body: `${r.lost} play${r.lost === 1 ? ' was' : 's were'} lost along the way.` };
  }
  return { ok: true, title: `${r.succeeded} people listened, and the counter says ${r.finalCount} 🎉`, body: 'Every single play was counted.' };
}

export const friendlyError = (status: number, msg?: string) =>
  status === 409 ? 'Another experiment is running. Try again in a moment ⏳' : (msg ?? `Something went wrong (${status})`);
