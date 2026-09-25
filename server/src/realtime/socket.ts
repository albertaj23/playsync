import type http from 'node:http';
import type { ResultSetHeader } from 'mysql2/promise';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { appPool } from '../db/pool.js';
import { setStepperEmitter } from '../lab/stepper/emitter.js';
import { setSimEmitter } from '../lab/sim/emitter.js';
import { simEngine } from '../lab/sim/engine.js';
import { getSnapshot } from '../services/playback.js';
import { deviceConnected, deviceDisconnected } from './presence.js';
import { setPublisher, type Publisher } from './publisher.js';

// Rooms: account:{id} receives `account_state` snapshots; device:{id} receives `session_lost`;
// `stepper` receives `stepper_update` (not account-scoped: the stepper is a single shared session).
// A client joins with {accountId, deviceId}; an observer (the wall's admin view) omits deviceId.

const Join = z.object({
  accountId: z.coerce.number().int().positive(),
  deviceId: z.coerce.number().int().positive().optional(),
});

export function attachSocket(server: http.Server): Server {
  const io = new Server(server, { cors: { origin: true } });

  async function pushSnapshot(accountId: number) {
    try {
      const snap = await getSnapshot(accountId);
      if (snap) io.to(`account:${accountId}`).emit('account_state', snap);
    } catch (err) {
      console.error('snapshot push failed', err);
    }
  }

  const publisher: Publisher = {
    accountChanged: (accountId) => { void pushSnapshot(accountId); },
    sessionLost: (deviceId, payload) => { io.to(`device:${deviceId}`).emit('session_lost', payload); },
    strategyChanged: () => {
      for (const room of io.sockets.adapter.rooms.keys()) {
        if (room.startsWith('account:')) void pushSnapshot(Number(room.slice('account:'.length)));
      }
    },
  };
  setPublisher(publisher);
  setStepperEmitter((update) => { io.to('stepper').emit('stepper_update', update); });
  setSimEmitter({
    tick: (t) => { io.to('sim').emit('sim_tick', t); },
    done: (s) => { io.to('sim').emit('sim_done', s); },
  });

  io.on('connection', (socket: Socket) => {
    let joined: { accountId: number; deviceId?: number } | null = null;

    socket.on('join_stepper', async (_raw: unknown, ack?: (res: object) => void) => {
      await socket.join('stepper');
      ack?.({ ok: true });
    });

    socket.on('join_sim', async (_raw: unknown, ack?: (res: object) => void) => {
      await socket.join('sim');
      ack?.({ ok: true, snapshot: simEngine.snapshot() });
    });

    socket.on('join', async (raw: unknown, ack?: (res: object) => void) => {
      const parsed = Join.safeParse(raw);
      if (!parsed.success || joined) { ack?.({ ok: false }); return; }
      const { accountId, deviceId } = parsed.data;
      try {
        if (deviceId !== undefined) {
          // The device must belong to the account; otherwise it would receive another account's events.
          const [res] = await appPool.query<ResultSetHeader>(
            'UPDATE device SET last_seen_at = NOW(3) WHERE device_id = ? AND account_id = ?', [deviceId, accountId]);
          if (res.affectedRows === 0) { ack?.({ ok: false }); return; }
          await socket.join(`device:${deviceId}`);
        }
        await socket.join(`account:${accountId}`);
      } catch (err) {
        console.error('join failed', err);
        ack?.({ ok: false });
        return;
      }
      if (socket.disconnected) return;
      joined = { accountId, deviceId };
      const cameOnline = deviceId !== undefined && deviceConnected(deviceId);
      ack?.({ ok: true });
      // The joiner needs a first snapshot. If presence changed, everyone watching gets one.
      if (cameOnline) publisher.accountChanged(accountId);
      else {
        const snap = await getSnapshot(accountId).catch(() => null);
        if (snap) socket.emit('account_state', snap);
      }
    });

    socket.on('disconnect', () => {
      // Deliberately does NOT end the session: the lease handles that.
      if (joined?.deviceId !== undefined && deviceDisconnected(joined.deviceId)) {
        publisher.accountChanged(joined.accountId);
      }
    });
  });

  return io;
}
