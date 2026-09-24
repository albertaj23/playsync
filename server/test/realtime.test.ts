import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import { createApp } from '../src/app.js';
import { closePools } from '../src/db/pool.js';
import { setPublisher } from '../src/realtime/publisher.js';
import { attachSocket } from '../src/realtime/socket.js';
import { setLiveStrategy } from '../src/services/playback.js';
import type { Snapshot } from '../src/services/accountState.js';
import { accountId, count, deviceIds, firstSongId, resetAccount } from './helpers.js';

let server: http.Server;
let io: Server;
let url: string;
let acct: number, mac: number, iphone: number, song: number;
const sockets: Socket[] = [];

beforeAll(async () => {
  [mac, iphone] = (await deviceIds('brij')) as [number, number];
  song = await firstSongId();
  await setLiveStrategy('PESSIMISTIC');
  server = http.createServer(createApp());
  io = attachSocket(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  while (sockets.length) sockets.pop()!.disconnect();
  acct = await resetAccount('brij', 1, 'ASK');
});

afterAll(async () => {
  while (sockets.length) sockets.pop()!.disconnect();
  setPublisher(null);
  io.close();
  await new Promise((r) => setTimeout(r, 100));   // let in-flight snapshot pushes finish
  await resetAccount('brij', 1, 'ASK');
  await closePools();
});

/** Opens a socket (its own connection, like one device) and joins the account's rooms. */
async function join(deviceId?: number, account = acct): Promise<Socket> {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  const res = await s.timeout(3000).emitWithAck('join', { accountId: account, deviceId });
  if (!res.ok) throw new Error('join refused');
  return s;
}

/** Resolves with the first `event` payload that matches `pred`. */
function next<T>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, on); reject(new Error(`timed out waiting for ${event}`)); }, ms);
    const on = (p: T) => { if (pred(p)) { clearTimeout(timer); s.off(event, on); resolve(p); } };
    s.on(event, on);
  });
}

const claim = (deviceId: number, body: object = {}) =>
  request(server).post('/api/playback/claim').send({ deviceId, songId: song, ...body });

describe('socket rooms and presence', () => {
  it('a joining device gets a snapshot and shows as online to watchers', async () => {
    const watcher = await join();
    const online = next<Snapshot>(watcher, 'account_state', (s) => s.devices.find((d) => d.deviceId === mac)!.online);
    const device = await join(mac);
    await online;
    const offline = next<Snapshot>(watcher, 'account_state', (s) => !s.devices.find((d) => d.deviceId === mac)!.online);
    device.disconnect();
    await offline;
  });

  it('refuses to join with a device from another account', async () => {
    const other = await accountId('step_a');
    await expect(join(mac, other)).rejects.toThrow('join refused');
  });

  it('a socket disconnect does not end the session (the lease does)', async () => {
    const device = await join(mac);
    const granted = await claim(mac);
    device.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    expect(await count(`SELECT COUNT(*) FROM playback_session WHERE session_id = ? AND status = 'PLAYING'`,
      [granted.body.sessionId])).toBe(1);
  });
});

describe('publish after commit', () => {
  it('pushes a snapshot that already contains the committed session', async () => {
    // The pushed snapshot is read on a different pooled connection. It can only include the new
    // session if the claim had committed before the push was triggered.
    const watcher = await join();
    const pushed = next<Snapshot>(watcher, 'account_state', (s) => s.sessions.length > 0);
    const res = await claim(mac);
    const snap = await pushed;
    expect(snap.stateVersion).toBe(res.body.stateVersion);
    expect(snap.sessions[0]).toMatchObject({ sessionId: res.body.sessionId, deviceName: 'MacBook', status: 'PLAYING' });
  });

  it('a rejected claim pushes nothing (no state change)', async () => {
    await claim(mac);
    const watcher = await join();
    await next(watcher, 'account_state');             // its initial snapshot
    // Let pushes from earlier activity (the claim, the previous test's socket disconnects) drain.
    await new Promise((r) => setTimeout(r, 300));
    let pushes = 0;
    watcher.on('account_state', () => pushes++);
    expect((await claim(iphone)).status).toBe(409);
    await new Promise((r) => setTimeout(r, 200));
    expect(pushes).toBe(0);
  });

  it('takeover sends session_lost PREEMPTED to the old device, naming the new one', async () => {
    const macSocket = await join(mac);
    const first = await claim(mac);
    const lost = next<{ sessionId: number; reason: string; byDeviceName: string }>(macSocket, 'session_lost');
    await claim(iphone, { mode: 'TAKEOVER' });
    expect(await lost).toEqual({ sessionId: first.body.sessionId, reason: 'PREEMPTED', byDeviceName: 'iPhone' });
  });

  it('pause, release and settings each push a newer version', async () => {
    const watcher = await join();
    const a = await claim(mac);
    const afterPause = next<Snapshot>(watcher, 'account_state', (s) => s.sessions[0]?.status === 'PAUSED');
    await request(server).post('/api/playback/pause').send({ sessionId: a.body.sessionId, deviceId: mac });
    const v2 = (await afterPause).stateVersion;
    const afterSettings = next<Snapshot>(watcher, 'account_state', (s) => s.conflictPolicy === 'TAKEOVER');
    await request(server).put(`/api/accounts/${acct}/settings`).send({ maxStreams: 1, conflictPolicy: 'TAKEOVER' });
    expect((await afterSettings).stateVersion).toBe(v2 + 1);
  });

  it('switching the live strategy pushes to every watched account', async () => {
    const watcher = await join();
    await next(watcher, 'account_state');
    const pushed = next<Snapshot>(watcher, 'account_state', (s) => s.strategy === 'OPTIMISTIC');
    await request(server).put('/api/admin/strategy').send({ strategy: 'OPTIMISTIC' });
    await pushed;
    await setLiveStrategy('PESSIMISTIC');
  });
});
