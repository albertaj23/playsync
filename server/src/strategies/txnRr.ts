// TXN_RR: the NAIVE statements wrapped in BEGIN … COMMIT at REPEATABLE READ (lab option: READ COMMITTED).
//
// PREVENTS: partial effects (atomicity: a failure after the INSERT rolls the session back).
// ALLOWS write skew / phantom: at RR and RC a plain SELECT is a non-locking MVCC snapshot read,
// so both transactions still see "0 active" and both INSERT. ACID ≠ protection from write skew.
import type { Strategy } from './types.js';
import { withRetry, withTx } from '../db/tx.js';
import { countActive, grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const txnRr: Strategy = {
  name: 'TXN_RR',
  defaultIsolation: 'REPEATABLE READ',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  claim(conn, input, stats) {
    return withRetry(() => withTx(conn, input.isolation ?? 'REPEATABLE READ', async () => {
      const acct = await readAccount(conn, input.accountId);                       // snapshot read
      const active = await countActive(conn, input.accountId, input.deviceId);     // snapshot read
      const excess = active - acct.maxStreams + 1;
      if (excess > 0 && input.mode === 'NORMAL') return reject(conn, input, acct.stateVersion);
      const toPreempt = await oldestActive(conn, input.accountId, input.deviceId, excess);
      await raceDelay(input);
      return grant(conn, input, { strategy: 'TXN_RR', toPreempt });
    }), stats);
  },
};
