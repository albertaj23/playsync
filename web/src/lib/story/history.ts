interface HistoryLike { state: unknown; replaceState(s: unknown, t: string, url: string): void; pushState(s: unknown, t: string, url: string): void }
interface LocationLike { pathname: string; search: string }

const url = (l: LocationLike, id: string) => `${l.pathname}${l.search}#${id}`;

/** Scrolling updates the hash without adding history entries, so Back leaves the page. */
export function replaceHash(h: HistoryLike, l: LocationLike, id: string): void {
  h.replaceState(h.state, '', url(l, id));
}
/** A deliberate jump (rail, Next, palette) adds an entry, so Back undoes it. */
export function pushHash(h: HistoryLike, l: LocationLike, id: string): void {
  h.pushState(h.state, '', url(l, id));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}
