// SERIALIZABLE: the same statements as TXN_RR, at SERIALIZABLE.
//
// PREVENTS write skew / phantom: InnoDB turns every plain SELECT into a shared (S) next-key lock,
// so the COUNT locks the scanned index range of ix_session_account_status_lease, gap included.
// COST: both transactions hold S on the same range; each INSERT needs an insert-intention lock
// on that gap, which conflicts with the other's S lock → wait-for cycle → InnoDB kills one
// (deadlock 1213) and withRetry reruns it. Conflicts become deadlocks + retries, not violations.
import type { Strategy } from './types.js';
import { withRetry, withTx } from '../db/tx.js';
import { countActive, grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const serializable: Strategy = {
  name: 'SERIALIZABLE',
  defaultIsolation: 'SERIALIZABLE',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  claim(conn, input, stats) {
    return withRetry(() => withTx(conn, input.isolation ?? 'SERIALIZABLE', async () => {
      const acct = await readAccount(conn, input.accountId);                       // S lock on account row
      const active = await countActive(conn, input.accountId, input.deviceId);     // S next-key locks on range
      const excess = active - acct.maxStreams + 1;
      if (excess > 0 && input.mode === 'NORMAL') return reject(conn, input, acct.stateVersion);
      const toPreempt = await oldestActive(conn, input.accountId, input.deviceId, excess);
      await raceDelay(input);
      return grant(conn, input, { strategy: 'SERIALIZABLE', toPreempt });           // INSERT may deadlock
    }), stats);
  },
};
