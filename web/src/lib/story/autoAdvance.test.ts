import { describe, expect, it } from 'vitest';
import { shouldAutoAdvance } from './autoAdvance';

const base = { pressedAt: 1000, lastUserInputAt: 900, resultAt: 3000, targetVisibleRatio: 0 };
describe('shouldAutoAdvance', () => {
  it('advances when untouched, fast and the target is off screen', () => expect(shouldAutoAdvance(base)).toBe(true));
  it('does not advance if the user scrolled/typed after pressing', () => expect(shouldAutoAdvance({ ...base, lastUserInputAt: 1500 })).toBe(false));
  it('does not advance when the result took longer than 10 s', () => expect(shouldAutoAdvance({ ...base, resultAt: 12_000 })).toBe(false));
  it('does not advance when the target is already half visible', () => {
    expect(shouldAutoAdvance({ ...base, targetVisibleRatio: 0.5 })).toBe(false);
    expect(shouldAutoAdvance({ ...base, targetVisibleRatio: 0.49 })).toBe(true);
  });
});
