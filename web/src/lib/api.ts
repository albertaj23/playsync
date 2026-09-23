// Thin typed wrapper around the REST API. Non-2xx responses are returned, not thrown,
// because 409 (limit reached) and 410 (session lost) are normal outcomes here.

export type StrategyName = 'NAIVE' | 'TXN_RR' | 'SERIALIZABLE' | 'PESSIMISTIC' | 'OPTIMISTIC' | 'CONSTRAINT';
export type Policy = 'REJECT' | 'TAKEOVER' | 'ASK';

export interface ApiResult<T> { ok: boolean; status: number; body: T }

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body: json };
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => call<T>('PUT', path, body),
};

export interface Health { ok: boolean; db?: { version: string; name: string; defaultIsolation: string; now: string }; error?: string }
export interface AppConfig { leaseMs: number; heartbeatMs: number; strategy: StrategyName }
export interface Song { songId: number; title: string; artist: string; durationMs: number; playCount: number }

export interface Snapshot {
  accountId: number; stateVersion: number; maxStreams: number; conflictPolicy: Policy; strategy: StrategyName;
  devices: { deviceId: number; deviceName: string; deviceType: string; online: boolean }[];
  sessions: {
    sessionId: number; deviceId: number; deviceName: string; songId: number; songTitle: string;
    status: 'PLAYING' | 'PAUSED'; positionMs: number; leaseRemainingMs: number | null;
  }[];
}

export interface Holder { sessionId: number; deviceId: number; deviceName: string }
export type ClaimResponse =
  | { outcome: 'GRANTED'; sessionId: number; stateVersion: number; preempted: number[]; strategy: StrategyName }
  | { outcome: 'REJECTED'; code: 'LIMIT_REACHED'; holders: Holder[]; policy: Policy; canTakeOver: boolean };

export interface ErrorBody { code: string; message?: string; reason?: string }

export interface EventRow {
  eventId: number; type: string; deviceId: number; deviceName: string | null; sessionId: number | null;
  stateVersion: number; clientRequestId: string | null; detail: Record<string, unknown> | null; at: string;
}

export interface Overview {
  tables: {
    name: string; rows: number;
    indexes: { name: string; unique: boolean; columns: string }[];
    foreignKeys: { name: string; columns: string; refTable: string; refColumns: string }[];
  }[];
  accounts: { demo: number; lab: number; stepper: number };
}

export interface RaceParams {
  strategy: StrategyName; concurrency: number; accounts: number; maxStreams: number;
  raceDelayMs: number; mode: 'NORMAL' | 'TAKEOVER'; isolation?: string;
}
export interface RaceResult extends RaceParams {
  isolationUsed: string; granted: number; rejected: number; errors: number;
  retries: number; deadlocks: number; lockTimeouts: number; violations: number;
  p50Ms: number; p95Ms: number; wallMs: number; throughputRps: number; errorSamples: string[];
}
