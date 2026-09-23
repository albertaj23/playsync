// OPTIMISTIC: read without locks, validate with compare-and-set on account.state_version.
//
//   read phase:       SELECT max_streams, state_version (= v); COUNT      ← no locks
//   validation phase: UPDATE account SET state_version = v + 1
//                     WHERE account_id = ? AND state_version = v          ← 0 rows ⇒ conflict
//   write phase:      INSERT session, events → COMMIT
//
// PREVENTS write skew: every change to the active set (claim, pause, release, preempt, expire)
// bumps state_version, so if the CAS matches, the set can only have SHRUNK since the read
// (leases lapse without a bump but can never be revived). Worst case: a spurious rejection,
// never a violation. The CAS takes a short X lock on the account row: OCC on a locking engine
// still validates with a write lock, but only for the write phase, not while "thinking".
// COST: under contention most validations fail → rollback + retry; the abort rate climbs.
import { OccConflictError, withRetry, withTx } from '../db/tx.js';
import type { ResultSetHeader } from 'mysql2/promise';
import type { Strategy } from './types.js';
import { countActive, grant, oldestActive, raceDelay, readAccount, reject } from './common.js';

export const optimistic: Strategy = {
  name: 'OPTIMISTIC',
  defaultIsolation: 'READ COMMITTED',
  supportsMaxStreamsAbove1: true,
  needsUniqueIndex: false,
  claim(conn, input, stats) {
    return withRetry(() => withTx(conn, input.isolation ?? 'READ COMMITTED', async () => {
      // Read phase
      const acct = await readAccount(conn, input.accountId);
      const active = await countActive(conn, input.accountId, input.deviceId);
      const excess = active - acct.maxStreams + 1;
      if (excess > 0 && input.mode === 'NORMAL') return reject(conn, input, acct.stateVersion);
      const toPreempt = await oldestActive(conn, input.accountId, input.deviceId, excess);
      await raceDelay(input);

      // Validation phase: compare-and-set
      const [cas] = await conn.query<ResultSetHeader>(
        'UPDATE account SET state_version = state_version + 1 WHERE account_id = ? AND state_version = ?',
        [input.accountId, acct.stateVersion],
      );
      if (cas.affectedRows === 0) throw new OccConflictError();

      // Write phase (we now hold the account row's X lock until COMMIT)
      return grant(conn, input, { strategy: 'OPTIMISTIC', toPreempt, stateVersion: acct.stateVersion + 1 });
    }), stats);
  },
};
