import { afterEach, describe, expect, it, vi } from 'vitest';
import { recall, remember } from './scrollMemory';

afterEach(() => vi.unstubAllGlobals());

describe('scrollMemory', () => {
  it('stores and recalls by key', () => {
    const data: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } });
    remember('a', 120.4); remember('b', 5);
    expect(recall('a')).toBe(120);
    expect(recall('b')).toBe(5);
    expect(recall('missing')).toBeNull();
  });
  it('does nothing (and does not throw) when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => remember('a', 1)).not.toThrow();
    expect(recall('a')).toBeNull();
  });
});
