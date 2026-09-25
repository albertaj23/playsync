import { describe, expect, it } from 'vitest';
import { modeFor, readPref } from './shell';

describe('modeFor', () => {
  it('desktop follows the preference, tablet is a rail, phone hides it', () => {
    expect(modeFor(1440, 'expanded', false)).toBe('expanded');
    expect(modeFor(1440, 'rail', false)).toBe('rail');
    expect(modeFor(1024, 'expanded', false)).toBe('rail');
    expect(modeFor(375, 'expanded', false)).toBe('hidden');
  });
  it('a forced rail (live simulation focus) only affects desktop', () => {
    expect(modeFor(1440, 'expanded', false, true)).toBe('rail');
    expect(modeFor(375, 'expanded', false, true)).toBe('hidden');
  });
  it('focus mode hides the sidebar at every width', () => {
    expect(modeFor(1440, 'expanded', true)).toBe('hidden');
  });
});

describe('readPref', () => {
  it('reads rail, defaults to expanded, and survives a throwing storage', () => {
    expect(readPref({ getItem: () => 'rail' })).toBe('rail');
    expect(readPref({ getItem: () => null })).toBe('expanded');
    expect(readPref({ getItem: () => { throw new Error('blocked'); } })).toBe('expanded');
    expect(readPref(null)).toBe('expanded');
  });
});
