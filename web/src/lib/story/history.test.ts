import { describe, expect, it, vi } from 'vitest';
import { debounce, pushHash, replaceHash } from './history';

const mk = () => ({ state: { k: 1 }, replaceState: vi.fn(), pushState: vi.fn() });
const loc = { pathname: '/stress', search: '?exp=count' };

describe('hash history rules', () => {
  it('scroll updates replace, deliberate jumps push', () => {
    const h = mk();
    replaceHash(h, loc, 'verdict');
    expect(h.replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/stress?exp=count#verdict');
    expect(h.pushState).not.toHaveBeenCalled();
    pushHash(h, loc, 'setup');
    expect(h.pushState).toHaveBeenCalledWith({ k: 1 }, '', '/stress?exp=count#setup');
  });
  it('debounce collapses rapid calls and can be cancelled', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d('a'); d('b'); d('c');
    vi.advanceTimersByTime(299); expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(fn).toHaveBeenCalledTimes(1); expect(fn).toHaveBeenCalledWith('c');
    d('x'); d.cancel(); vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
