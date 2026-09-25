import { useEffect, useRef } from 'react';

/** True when the event target is somewhere the user types (so single-key shortcuts must not fire). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Parses "mod+b", "alt+arrowdown", "?" and tests a keyboard event against it. `mod` = Cmd on Mac, Ctrl elsewhere. */
export function matchCombo(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const want = { mod: parts.includes('mod'), alt: parts.includes('alt'), shift: parts.includes('shift') };
  const mod = e.metaKey || e.ctrlKey;
  if (want.mod !== mod || want.alt !== e.altKey) return false;
  if (!want.shift && key.length > 1 && e.shiftKey) return false;
  return e.key.toLowerCase() === key;
}

/** Registers a global shortcut. Combos without a modifier are ignored while typing. */
export function useShortcut(combo: string, fn: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matchCombo(e, combo)) return;
      if (!/mod\+/i.test(combo) && isTypingTarget(e.target)) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, enabled]);
}
