import { describe, expect, it } from 'vitest';
import { activeChapter, chapterAt, progressFor } from './progress';

describe('progressFor', () => {
  // scene 2000 tall, viewport 800, sticky bar 56 => scrub distance 2000 - 744 = 1256
  it('is 0 before the scene reaches the sticky line, 1 after it ends, and linear between', () => {
    expect(progressFor(300, 2000, 800, 56)).toBe(0);
    expect(progressFor(56, 2000, 800, 56)).toBe(0);
    expect(progressFor(56 - 628, 2000, 800, 56)).toBeCloseTo(0.5, 5);
    expect(progressFor(56 - 1256, 2000, 800, 56)).toBe(1);
    expect(progressFor(-5000, 2000, 800, 56)).toBe(1);
  });
  it('a scene shorter than the viewport is only ever 0 or 1', () => {
    expect(progressFor(200, 500, 800, 56)).toBe(0);
    expect(progressFor(20, 500, 800, 56)).toBe(1);
  });
});

describe('chapterAt', () => {
  const cuts = [0.08, 0.36, 0.68];
  it('returns -1 before the first cut and the last reached cut after', () => {
    expect(chapterAt(0, cuts)).toBe(-1);
    expect(chapterAt(0.08, cuts)).toBe(0);
    expect(chapterAt(0.5, cuts)).toBe(1);
    expect(chapterAt(1, cuts)).toBe(2);
  });
});

describe('activeChapter', () => {
  const tops = (a: number, b: number, c: number) => [{ id: 'a', top: a }, { id: 'b', top: b }, { id: 'c', top: c }];
  it('picks the last chapter whose top crossed 40% of the visible area', () => {
    // viewport 800, bar 56 => line = 56 + 0.4*744 = 353.6
    expect(activeChapter(tops(10, 900, 1800), 800, 56)).toBe('a');
    expect(activeChapter(tops(-700, 300, 1200), 800, 56)).toBe('b');
    expect(activeChapter(tops(-2000, -900, 340), 800, 56)).toBe('c');
  });
  it('at the bottom of the page it is the last chapter, and empty lists give null', () => {
    expect(activeChapter(tops(-700, 300, 1200), 800, 56, true)).toBe('c');
    expect(activeChapter([], 800, 56)).toBeNull();
  });
  it('falls back to the first chapter when none has crossed the line', () => {
    expect(activeChapter(tops(600, 1400, 2000), 800, 56)).toBe('a');
  });
});
