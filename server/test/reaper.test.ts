import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appPool, closePools } from '../src/db/pool.js';
import { newStats } from '../src/db/tx.js';
import { setPublisher, type SessionLost } from '../src/realtime/publisher.js';
import { reapOnce, startReaper } from '../src/services/leaseReaper.js';
import { claim, heartbeat, setLiveStrategy } from '../src/services/playback.js';
import { executeClaim, strategies } from '../src/strategies/index.js';
import { deviceIds, expireLease, firstSongId, resetAccount, sessionRow, stateVersion, count } from './helpers.js';

let acct: number, mac: number, song: number;
const pushes: number[] = [];
const lost: [number, SessionLost][] = [];

beforeAll(async () => {
  [mac] = (await deviceIds('brij')) as [number];
  song = await firstSongId();
  await setLiveStrategy('PESSIMISTIC');
  setPublisher({
    accountChanged: (id) => pushes.push(id),
    sessionLost: (deviceId, p) => lost.push([deviceId, p]),
    strategyChanged: () => {},
  });
});
beforeEach(async () => {
  acct = await resetAccount('brij', 1, 'ASK');
  pushes.length = 0;
  lost.length = 0;
});
afterEach(async () => { await resetAccount('lab_01'); });
afterAll(async () => {
  setPublisher(null);
  await resetAccount('brij', 1, 'ASK');
  await closePools();
});

async function play(): Promise<number> {
  const r = await claim({ deviceId: mac, songId: song, mode: 'NORMAL' });
  if (r.outcome !== 'GRANTED') throw new Error('expected grant');
  return r.sessionId;
}

describe('lease reaper', () => {
  it('expires a lapsed session, bumps the version, logs EXPIRED and notifies after commit', async () => {
    const sid = await play();
    const v = await stateVersion(acct);
    await expireLease(sid);
    pushes.length = 0;

    const results = await reapOnce();
    expect(results.find((r) => r.accountId === acct)?.expired).toEqual([{ sessionId: sid, deviceId: mac }]);
    expect((await sessionRow(sid))!.status).toBe('EXPIRED');
    expect(await stateVersion(acct)).toBe(v + 1);
    expect(await count(`SELECT COUNT(*) FROM playback_event WHERE session_id = ? AND event_type = 'EXPIRED'`, [sid])).toBe(1);
    expect(pushes).toContain(acct);
    expect(lost).toContainEqual([mac, { sessionId: sid, reason: 'EXPIRED' }]);
  });

  it('ended_at is the moment the lease lapsed, not the moment the reaper ran', async () => {
    const sid = await play();
    await expireLease(sid);
    await reapOnce();
    expect(await count('SELECT ended_at = lease_expires_at FROM playback_session WHERE session_id = ?', [sid])).toBe(1);
  });

  it('leaves live leases alone', async () => {
    const sid = await play();
    await reapOnce();
    expect((await sessionRow(sid))!.status).toBe('PLAYING');
  });

  it('a heartbeat after reaping is still fenced (410 EXPIRED)', async () => {
    const sid = await play();
    await expireLease(sid);
    await reapOnce();
    await expect(heartbeat(sid, mac, 1000)).rejects.toMatchObject({ reason: 'EXPIRED' });
  });

  it('skips lab accounts so experiments are not disturbed', async () => {
    const lab = await resetAccount('lab_01');
    const [labDev] = await deviceIds('lab_01');
    const conn = await appPool.getConnection();
    const r = await executeClaim(strategies.PESSIMISTIC, conn,
      { accountId: lab, deviceId: labDev!, songId: song, mode: 'NORMAL' }, newStats()).finally(() => conn.release());
    if (r.outcome !== 'GRANTED') throw new Error('expected grant');
    await expireLease(r.sessionId);
    await reapOnce();
    expect((await sessionRow(r.sessionId))!.status).toBe('PLAYING');
  });

  it('running on a timer, expires a session within lease + reaper interval', async () => {
    // Scaled-down version of "within LEASE_MS + REAPER_MS": a 300 ms lease and a 200 ms reaper.
    const sid = await play();
    await appPool.query(
      'UPDATE playback_session SET lease_expires_at = NOW(3) + INTERVAL 300000 MICROSECOND WHERE session_id = ?', [sid]);
    const t0 = Date.now();
    const stop = startReaper(200);
    try {
      while ((await sessionRow(sid))!.status === 'PLAYING') {
        if (Date.now() - t0 > 2000) throw new Error('not reaped in time');
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      stop();
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(300 + 200 + 250);   // lease + one interval + slack for the pass itself
  });
});
