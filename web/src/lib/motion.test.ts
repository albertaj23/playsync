import { afterEach, describe, expect, it, vi } from 'vitest';
import { countUp, reduced, shake } from './motion';
import { describeMessage } from '../components/device/deviceMessages';

afterEach(() => vi.unstubAllGlobals());

describe('motion presets under prefers-reduced-motion', () => {
  it('reduced() reflects the media query', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(reduced()).toBe(true);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(reduced()).toBe(false);
  });

  it('countUp jumps straight to the exact value when reduced', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const el = { dataset: {} as Record<string, string>, textContent: '' } as unknown as HTMLElement;
    countUp(el, 42);
    expect(el.textContent).toBe('42');
    countUp(el, 7, (n) => `${n} plays`);
    expect(el.textContent).toBe('7 plays');
  });

  it('presets are safe no-ops with no target', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(() => shake(null)).not.toThrow();
  });
});

describe('friendly device messages', () => {
  it('never shows jargon', () => {
    const texts = [
      describeMessage({ kind: 'moved', to: 'iPhone', whileOffline: false } as never),
      describeMessage({ kind: 'timedOut', whileOffline: true } as never),
      describeMessage({ kind: 'busy', holders: ['MacBook'] } as never),
    ].map((m) => `${m.title} ${m.body ?? ''}`).join(' ');
    expect(texts).not.toMatch(/lease|409|410|session|heartbeat|fenc/i);
    expect(texts).toContain('hopped over to iPhone');
  });
});
