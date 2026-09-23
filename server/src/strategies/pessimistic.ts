// PESSIMISTIC: lock the parent account row first, at READ COMMITTED.
//
//   SELECT … FROM account WHERE account_id = ? FOR UPDATE   ← per-account mutex (X record lock)
//   COUNT → INSERT → bump → COMMIT                          ← lock held until commit (strict 2PL)
//
// PREVENTS write skew: a second claim for the same account blocks on the account row until the
// first commits. Locking the single parent row (not the empty session range) avoids gap locks.
// READ COMMITTED matters: each statement reads the latest committed data, so the COUNT taken
// after the lock sees the winner's session. At REPEATABLE READ a plain read done BEFORE the lock
// would pin an older snapshot (the PESSIMISTIC_RR_PITFALL stepper scenario).
// COST: claims for the same account run one at a time, so p95 grows with contention.
import type { Strategy } from './types.js';
import { withRetry, withTx } from '../db/tx.js';
import { countActive, grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const pessimistic: Strategy = {
  name: 'PESSIMISTIC',
  defaultIsolation: 'READ COMMITTED',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  claim(conn, input, stats) {
    return withRetry(() => withTx(conn, input.isolation ?? 'READ COMMITTED', async () => {
      const acct = await readAccount(conn, input.accountId, 'FOR UPDATE');         // FIRST statement
      const active = await countActive(conn, input.accountId, input.deviceId);
      const excess = active - acct.maxStreams + 1;
      if (excess > 0 && input.mode === 'NORMAL') return reject(conn, input, acct.stateVersion);
      const toPreempt = await oldestActive(conn, input.accountId, input.deviceId, excess);
      await raceDelay(input);
      return grant(conn, input, { strategy: 'PESSIMISTIC', toPreempt });
    }), stats);
  },
};
