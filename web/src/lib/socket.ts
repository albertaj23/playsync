import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot } from './api';
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

/** Lease remaining right now, interpolated from the last pushed value. */
export function leaseRemaining(snap: LiveSnapshot, leaseRemainingMs: number | null): number {
  return leaseRemainingMs === null ? 0 : Math.max(0, leaseRemainingMs - (Date.now() - snap.receivedAt));
}
