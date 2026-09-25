import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closePools } from './db/pool.js';
import { attachSocket } from './realtime/socket.js';
import { engine as stepperEngine } from './lab/stepper/engine.js';
import { closeRedis } from './db/redis.js';
import { simEngine } from './lab/sim/engine.js';
import { startReaper } from './services/leaseReaper.js';
import { setLiveStrategy } from './services/playback.js';

// Make the schema match the configured strategy (adds/drops the CONSTRAINT unique index).
await setLiveStrategy(config.DEFAULT_STRATEGY);

const server = http.createServer(createApp());
const io = attachSocket(server);
const stopReaper = startReaper(config.REAPER_MS);

// Bind to 0.0.0.0 so a phone on the same LAN can reach the API.
server.listen(config.PORT, '0.0.0.0', () => {
  console.log(`playsync server listening on http://0.0.0.0:${config.PORT} (strategy ${config.DEFAULT_STRATEGY}, reaper every ${config.REAPER_MS} ms)`);
});

async function shutdown() {
  stopReaper();
  io.close();
  server.close();
  await simEngine.closeAll();
  await stepperEngine.closeAll();
  await closeRedis();
  await closePools();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
