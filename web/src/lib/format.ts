export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtSec = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
