// MySQL server error numbers this project reacts to.
export const ER_DUP_ENTRY = 1062;          // unique-key violation (CONSTRAINT strategy conflict)
export const ER_LOCK_WAIT_TIMEOUT = 1205;  // innodb_lock_wait_timeout exceeded
export const ER_LOCK_DEADLOCK = 1213;      // InnoDB picked this txn as the deadlock victim
export const ER_SIGNAL = 1644;             // SIGNAL SQLSTATE '45000' raised by the stream-limit trigger
export const ER_NO_REFERENCED_ROW_2 = 1452; // FK violation: parent row missing

interface MysqlError { errno?: unknown }

export function errnoOf(err: unknown): number | undefined {
  const n = (err as MysqlError | null)?.errno;
  return typeof n === 'number' ? n : undefined;
}

export const isDupEntry = (err: unknown) => errnoOf(err) === ER_DUP_ENTRY;
export const isLockWaitTimeout = (err: unknown) => errnoOf(err) === ER_LOCK_WAIT_TIMEOUT;
export const isDeadlock = (err: unknown) => errnoOf(err) === ER_LOCK_DEADLOCK;
export const isFkViolation = (err: unknown) => errnoOf(err) === ER_NO_REFERENCED_ROW_2;
