// Keeps only the newest account state. Socket pushes can arrive out of order (two commits
// publish concurrently; a reconnect's first snapshot races a push), and every committed state
// change bumps account.state_version, so a snapshot with a LOWER version is stale and dropped.
//
// Equal versions are accepted: they describe the same committed set of sessions and differ
// only in unversioned, monotonic-in-time fields (lease remaining, positions, online presence,
// live strategy), where the latest arrival is the best information we have.

export interface Versioned { stateVersion: number }

export class VersionedStore<T extends Versioned> {
  private current: T | null = null;

  get value(): T | null { return this.current; }
  get version(): number { return this.current?.stateVersion ?? -1; }

  /** Applies `next` unless it is older than what we hold. Returns whether it was applied. */
  apply(next: T): boolean {
    if (next.stateVersion < this.version) return false;
    this.current = next;
    return true;
  }
}
