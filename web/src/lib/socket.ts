import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot, StepperUpdate } from './api';
import type { SimSnapshot, SimSummary, SimTick } from './sim';
import { recordTrace } from './trace';
import { VersionedStore } from './versionedStore';

export interface SessionLost { sessionId: number; reason: 'PREEMPTED' | 'EXPIRED' | 'ENDED'; byDeviceName?: string }

export interface LiveSnapshot extends Snapshot {
  /** Local time the snapshot arrived, to count leases down between pushes. */
  receivedAt: number;
}

/**
 * Subscribes to an account's live state over its OWN socket connection (forceNew), so every
 * device panel is an independent client, exactly like separate phones/laptops would be.
 * Pass a deviceId to join as that device (it shows as online and receives session_lost);
 * omit it to watch as an observer. `enabled: false` drops the connection (a sleeping laptop).
 */
export function useAccountState(opts: {
  accountId: number | null;
  deviceId?: number;
  enabled?: boolean;
  onSessionLost?: (p: SessionLost) => void;
}) {
  const { accountId, deviceId, enabled = true } = opts;
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const store = useRef(new VersionedStore<LiveSnapshot>());
  const onLost = useRef(opts.onSessionLost);
  onLost.current = opts.onSessionLost;

  useEffect(() => {
    if (accountId === null || !enabled) { setConnected(false); return; }
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket'], forceNew: true });
    // (Re)join on every connect: socket.io reconnects on its own after network blips.
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', { accountId, deviceId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('account_state', (snap: Snapshot) => {
      if (store.current.apply({ ...snap, receivedAt: Date.now() })) setSnapshot(store.current.value);
    });
    socket.on('session_lost', (p: SessionLost) => {
      recordTrace({
        kind: 'push', event: 'session_lost', deviceId,
        summary: `push session_lost #${p.sessionId} → ${p.reason}${p.byDeviceName ? ` by ${p.byDeviceName}` : ''}`,
      });
      onLost.current?.(p);
    });
    return () => { socket.disconnect(); };
  }, [accountId, deviceId, enabled]);

  return { snapshot, connected };
}

/**
 * Watches the Transaction Stepper's shared session (not account-scoped, so no accountId/deviceId
 * needed). Reports connection status and forwards every `stepper_update` push to `onUpdate`.
 */
export function useStepperUpdates(onUpdate: (u: StepperUpdate) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onUpdate);
  cb.current = onUpdate;

  useEffect(() => {
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket'], forceNew: true });
    socket.on('connect', () => { setConnected(true); socket.emit('join_stepper', {}); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('stepper_update', (u: StepperUpdate) => cb.current(u));
    return () => { socket.disconnect(); };
  }, []);

  return { connected };
}

/** Joins the simulation room; forwards each tick and the final summary. Returns the join-time snapshot via `onSnapshot`. */
export function useSimSocket(h: {
  onSnapshot: (s: SimSnapshot) => void; onTick: (t: SimTick) => void; onDone: (s: SimSummary) => void;
}): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket'], forceNew: true });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_sim', {}, (res: { snapshot?: SimSnapshot }) => { if (res?.snapshot) ref.current.onSnapshot(res.snapshot); });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('sim_tick', (t: SimTick) => ref.current.onTick(t));
    socket.on('sim_done', (s: SimSummary) => ref.current.onDone(s));
    return () => { socket.disconnect(); };
  }, []);
  return { connected };
}

/** Lease remaining right now, interpolated from the last pushed value. */
export function leaseRemaining(snap: LiveSnapshot, leaseRemainingMs: number | null): number {
  return leaseRemainingMs === null ? 0 : Math.max(0, leaseRemainingMs - (Date.now() - snap.receivedAt));
}
