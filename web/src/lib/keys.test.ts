import { describe, expect, it } from 'vitest';
import { isTypingTarget, matchCombo } from './keys';

const el = (tagName: string, extra: object = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

describe('isTypingTarget', () => {
  it('is true for inputs, textareas, selects and contenteditable', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
  });
  it('is false for buttons, null and non-elements', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe('matchCombo', () => {
  const ev = (o: object) => ({ key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  it('mod matches Cmd or Ctrl', () => {
    expect(matchCombo(ev({ key: 'b', metaKey: true }), 'mod+b')).toBe(true);
    expect(matchCombo(ev({ key: 'B', ctrlKey: true }), 'mod+b')).toBe(true);
    expect(matchCombo(ev({ key: 'b' }), 'mod+b')).toBe(false);
  });
  it('alt combos and bare keys', () => {
    expect(matchCombo(ev({ key: 'ArrowDown', altKey: true }), 'alt+arrowdown')).toBe(true);
    expect(matchCombo(ev({ key: 'ArrowDown' }), 'alt+arrowdown')).toBe(false);
    expect(matchCombo(ev({ key: '?', shiftKey: true }), '?')).toBe(true);
  });
});
