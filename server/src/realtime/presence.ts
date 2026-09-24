// In-memory set of devices with at least one live socket. "Online" in snapshots comes from here.
// Presence is deliberately NOT tied to sessions: a socket disconnect never ends playback
// (the lease does that), so short network blips don't kill a stream.

const sockets = new Map<number, number>();   // deviceId → open socket count

export function deviceConnected(deviceId: number): boolean {
  const n = sockets.get(deviceId) ?? 0;
  sockets.set(deviceId, n + 1);
  return n === 0;                             // true if the device just came online
}

export function deviceDisconnected(deviceId: number): boolean {
  const n = (sockets.get(deviceId) ?? 1) - 1;
  if (n <= 0) sockets.delete(deviceId); else sockets.set(deviceId, n);
  return n <= 0;                              // true if the device just went offline
}

export const isOnline = (deviceId: number) => sockets.has(deviceId);
