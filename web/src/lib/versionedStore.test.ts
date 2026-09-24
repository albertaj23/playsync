import { describe, expect, it } from 'vitest';
import { VersionedStore } from './versionedStore';

const s = (stateVersion: number, tag = '') => ({ stateVersion, tag });

describe('VersionedStore', () => {
  it('applies the first snapshot and newer ones', () => {
    const store = new VersionedStore<ReturnType<typeof s>>();
    expect(store.apply(s(3))).toBe(true);
    expect(store.apply(s(4))).toBe(true);
    expect(store.value?.stateVersion).toBe(4);
  });

  it('drops a snapshot that arrives out of order', () => {
    const store = new VersionedStore<ReturnType<typeof s>>();
    for (const v of [1, 3, 2]) store.apply(s(v));
    expect(store.value?.stateVersion).toBe(3);
  });

  it('accepts an equal version (presence / lease refresh) and keeps the latest arrival', () => {
    const store = new VersionedStore<ReturnType<typeof s>>();
    store.apply(s(5, 'offline'));
    expect(store.apply(s(5, 'online'))).toBe(true);
    expect(store.value?.tag).toBe('online');
  });
});
