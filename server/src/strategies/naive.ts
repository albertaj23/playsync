// NAIVE: autocommit, no transaction.
//
//   SELECT COUNT(*) …  →  (race window)  →  INSERT session  →  bump version
//
// ALLOWS write skew / phantom: two devices both read "0 active", then both INSERT different rows.
// Each statement is atomic on its own, but nothing makes check + write atomic together, and a
// failure after the INSERT leaves the session behind (no atomicity across statements).
import type { Strategy } from './types.js';
import { countActive, grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const naive: Strategy = {
  name: 'NAIVE',
  defaultIsolation: 'AUTOCOMMIT',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  async claim(conn, input) {
    const acct = await readAccount(conn, input.accountId);
    const active = await countActive(conn, input.accountId, input.deviceId);
    const excess = active - acct.maxStreams + 1;
    if (excess > 0 && input.mode === 'NORMAL') return reject(conn, input, acct.stateVersion);
    const toPreempt = await oldestActive(conn, input.accountId, input.deviceId, excess);
    await raceDelay(input);
    return grant(conn, input, { strategy: 'NAIVE', toPreempt });
  },
};
