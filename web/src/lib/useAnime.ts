import { useRef, useEffect, useCallback } from 'react';
import { createScope, animate, type Scope } from 'animejs';

/**
 * React hook that creates an Anime.js v4 Scope tied to a DOM ref.
 * All animations created via the returned `animate` run inside the scope,
 * and are automatically reverted when the component unmounts.
 *
 * Usage:
 *   const { root, animate } = useAnime();
 *   return <div ref={root}>...</div>;
 */
export function useAnime<T extends HTMLElement = HTMLDivElement>() {
  const rootRef = useRef<T>(null);
  const scopeRef = useRef<Scope | null>(null);

  // The scope is created lazily: a page may render a "Loading…" branch (without the ref attached)
  // first and only attach the ref once its data has arrived, so a mount-only effect would find
  // rootRef.current === null and never create a scope, leaving every animate() call a silent no-op
  // (cards that start at opacity: 0 then stay invisible forever).
  const ensureScope = useCallback((): Scope | null => {
    if (!scopeRef.current && rootRef.current) scopeRef.current = createScope({ root: rootRef.current });
    return scopeRef.current;
  }, []);

  useEffect(() => {
    ensureScope();
    return () => {
      scopeRef.current?.revert();
      scopeRef.current = null;
    };
  }, [ensureScope]);

  const runInScope = useCallback(<R,>(fn: () => R): R | undefined => {
    const scope = ensureScope();
    if (!scope) return undefined;
    return scope.execute(fn);
  }, [ensureScope]);

  const animateWrapper = useCallback((target: any, options: any) => {
    return runInScope(() => {
      return animate(target, options);
    });
  }, [runInScope]);

  return { animRef: rootRef, scope: scopeRef, animate: animateWrapper, runInScope };
}

export { stagger } from 'animejs';
