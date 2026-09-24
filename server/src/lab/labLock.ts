// Cross-process mutex for the Concurrency Lab (STREAM_LIMIT and LOST_UPDATE experiments), built
// on the generic named-lock helper in db/namedLock.ts. See that file for why a MySQL named lock
// (not an in-process flag) is needed: it also coordinates the CLI bench and the test suite.

import { withNamedLock, NamedLockBusyError } from '../db/namedLock.js';

const LOCK_NAME = 'playsync.lab';

/** Thrown when another process or request already holds the lab lock. */
export class LabBusyError extends Error {
  constructor() {
    super('another experiment is running (UI, bench or tests)');
    this.name = 'LabBusyError';
  }
}

/**
 * Runs `fn` while holding the lab's named lock. Throws LabBusyError immediately if another
 * process/request holds it, rather than queuing - the lab has one experiment at a time.
 */
export async function withLabLock<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await withNamedLock(LOCK_NAME, 'another experiment is running (UI, bench or tests)', fn);
  } catch (err) {
    if (err instanceof NamedLockBusyError) throw new LabBusyError();
    throw err;
  }
}
