export const AUTO_ADVANCE_WINDOW_MS = 10_000;

/**
 * The one sanctioned programmatic scroll: after an action whose result lives further down, jump to
 * it only if the user has not touched the page since pressing the button, the result came fast,
 * and the target is not already mostly on screen.
 */
export function shouldAutoAdvance(a: { pressedAt: number; lastUserInputAt: number; resultAt: number; targetVisibleRatio: number }): boolean {
  if (a.lastUserInputAt > a.pressedAt) return false;
  if (a.resultAt - a.pressedAt > AUTO_ADVANCE_WINDOW_MS) return false;
  return a.targetVisibleRatio < 0.5;
}
