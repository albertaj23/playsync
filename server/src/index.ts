import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closePools } from './db/pool.js';

const server = http.createServer(createApp());

// Bind to 0.0.0.0 so a phone on the same LAN can reach the API.
server.listen(config.PORT, '0.0.0.0', () => {
  console.log(`playsync server listening on http://0.0.0.0:${config.PORT}`);
});

async function shutdown() {
  server.close();
  await closePools();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
