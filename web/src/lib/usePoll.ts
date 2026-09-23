import { useEffect, useRef } from 'react';

/** Calls `fn` now and every `ms` while mounted. Phase 3 replaces polling with socket pushes. */
export function usePoll(fn: () => void | Promise<void>, ms: number, deps: unknown[] = []) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    let alive = true;
    const tick = async () => { if (alive) await saved.current(); };
    void tick();
    const id = setInterval(tick, ms);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
