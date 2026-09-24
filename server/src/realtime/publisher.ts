// The service layer announces committed changes through this interface. It must only be called
// AFTER COMMIT: pushing from inside a transaction could show clients state that is later rolled
// back (an application-level dirty read). The default does nothing, so the service works (and is
// testable) without socket.io; realtime/socket.ts installs the real one.

export type LostReason = 'PREEMPTED' | 'EXPIRED' | 'ENDED';

export interface SessionLost { sessionId: number; reason: LostReason; byDeviceName?: string }

export interface Publisher {
  /** Push a fresh snapshot to everyone watching the account. */
  accountChanged(accountId: number): void;
  /** Tell one device its session is gone, so it stops immediately. */
  sessionLost(deviceId: number, payload: SessionLost): void;
  /** The live strategy changed: push snapshots to every watched account. */
  strategyChanged(): void;
}

const noop: Publisher = { accountChanged() {}, sessionLost() {}, strategyChanged() {} };
let current: Publisher = noop;

export const publish = (): Publisher => current;
export function setPublisher(p: Publisher | null): void { current = p ?? noop; }
