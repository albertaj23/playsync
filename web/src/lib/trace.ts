// A record of everything this browser did: every state-changing API call and every
// server push that told a device to stop. The friendly pages never show it; "Stats for nerds"
// does, next to the server-side checks that verify each action's effect.
//
// Stored in localStorage so a nerds tab sees what a devices tab does (the `storage` event
// fires in other tabs). Every access is guarded: storage can be unavailable (private mode).

import { useSyncExternalStore } from 'react';

export interface TraceEntry {
  id: number;
  at: number;                       // epoch ms
  kind: 'request' | 'push';
  deviceId?: number;
  method?: string;
  path?: string;
  body?: unknown;
  status?: number;
  response?: unknown;
  ms?: number;
  event?: string;
  summary: string;
}

const KEY = 'playsync.trace';
const MAX = 400;

let entries: TraceEntry[] = load();
const listeners = new Set<() => void>();

function load(): TraceEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TraceEntry[]) : [];
  } catch {
    return [];
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* storage full or blocked */ }
}

function emit() { for (const l of listeners) l(); }

try {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { entries = load(); emit(); }
  });
} catch { /* no window (tests) */ }

export function recordTrace(e: Omit<TraceEntry, 'id' | 'at'>) {
  const entry: TraceEntry = { ...e, id: Date.now() * 1000 + Math.floor(Math.random() * 1000), at: Date.now() };
  entries = [entry, ...entries].slice(0, MAX);
  save();
  emit();
}

export function clearTrace() {
  entries = [];
  save();
  emit();
}

export function useTrace(): TraceEntry[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => entries,
  );
}

/** One-line technical summary of an API call, for the trace table. */
export function summarize(method: string, path: string, body: Record<string, unknown> | undefined, status: number, res: Record<string, unknown>): string {
  const b = body ?? {};
  if (path === '/playback/claim') {
    const head = `claim song ${b.songId}${b.mode === 'TAKEOVER' ? ' (TAKEOVER)' : ''}`;
    if (status === 200) {
      const pre = (res.preempted as number[] | undefined) ?? [];
      return `${head} → GRANTED session #${res.sessionId}, v${res.stateVersion}${pre.length ? `, preempted #${pre.join(', #')}` : ''}`;
    }
    if (status === 409) {
      const holders = ((res.holders as { deviceName: string }[] | undefined) ?? []).map((h) => h.deviceName).join(', ');
      return `${head} → REJECTED, held by ${holders} (policy ${res.policy})`;
    }
  }
  if (path === '/playback/heartbeat') {
    return status === 200
      ? `heartbeat #${b.sessionId} → lease extended to ${((res.leaseRemainingMs as number) / 1000).toFixed(1)}s`
      : `heartbeat #${b.sessionId} → ${status} ${res.reason ?? ''} (fenced)`;
  }
  if (path === '/playback/pause' || path === '/playback/release') {
    const verb = path.endsWith('pause') ? 'pause' : 'release';
    return status === 200 ? `${verb} #${b.sessionId} → v${res.stateVersion}` : `${verb} #${b.sessionId} → ${status} ${res.reason ?? ''}`;
  }
  if (path.endsWith('/settings')) {
    return status === 200
      ? `settings max_streams=${b.maxStreams} policy=${b.conflictPolicy} → v${res.stateVersion}`
      : `settings → ${status} ${res.code ?? ''}: ${res.message ?? ''}`;
  }
  if (path === '/admin/strategy') return status === 200 ? `live strategy → ${b.strategy}` : `strategy → ${status} ${res.message ?? ''}`;
  if (path.endsWith('/end-all')) return `end all sessions → ${res.ended ?? 0} ended`;
  if (path === '/lab/race') {
    return status === 200
      ? `stress test ${b.strategy} ×${b.concurrency} → ${res.granted} granted, ${res.violations} violation(s), ${res.deadlocks} deadlock(s), ${res.retries} retr${res.retries === 1 ? 'y' : 'ies'}`
      : `stress test ${b.strategy} → ${status} ${res.message ?? ''}`;
  }
  if (path === '/lab/experiments') {
    if (status !== 200) return `experiment ${b.strategy} → ${status} ${res.message ?? ''}`;
    const agg = (res.aggregate ?? {}) as { trials?: number; trialsWithViolations?: number };
    return `experiment ${b.strategy} ×${b.concurrency}, ${agg.trials} trials → 0 violations in ${(agg.trials ?? 0) - (agg.trialsWithViolations ?? 0)}/${agg.trials}`;
  }
  if (path === '/lab/lost-update') {
    if (status !== 200) return `lost update ${b.variant} → ${status} ${res.message ?? ''}`;
    const agg = (res.aggregate ?? {}) as { finalCountMean?: number; lostMean?: number };
    return `lost update ${b.variant} ×${b.increments} → counter ${agg.finalCountMean}, ${agg.lostMean} lost`;
  }
  return `${method} ${path} → ${status}`;
}
