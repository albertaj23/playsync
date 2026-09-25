// Redis client for the REDIS_LEASE strategy (Phase 7 stretch). Connected lazily, so nothing in the
// app needs Redis unless that strategy is actually used.
import { Redis } from 'ioredis';
import { config } from '../config.js';

let client: Redis | null = null;
/** True once any REDIS_LEASE claim ran: only then do heartbeat/release hooks talk to Redis. */
let inUse = false;

export function getRedis(): Redis {
  if (!client) client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
  inUse = true;
  return client;
}
export const redisInUse = () => inUse;

export async function closeRedis(): Promise<void> {
  if (client) { await client.quit().catch(() => undefined); client = null; }
}

export const slotKey = (accountId: number, n: number) => `playsync:slot:${accountId}:${n}`;
const MAX_SLOTS = 10;

/**
 * One atomic step (Lua): give this device a slot for the account.
 *   1. if the device already holds a slot, refresh it;  2. else take the first free slot (SET NX);
 *   3. else, when `takeover`, steal the slot with the OLDEST timestamp.
 * Returns {slotIndex, stolenDevice}; slotIndex -1 means the limit is reached. The value stored is
 * "<deviceId>:<startedAtMs>". Lua runs atomically in Redis, which is exactly what makes this safe.
 */
const ACQUIRE = `
local n = tonumber(ARGV[1]); local device = ARGV[2]; local value = ARGV[3]; local ttl = ARGV[4]; local takeover = ARGV[5]
for i = 1, n do
  local v = redis.call('GET', KEYS[i])
  if v and string.match(v, '^(%d+):') == device then redis.call('SET', KEYS[i], value, 'PX', ttl); return {i - 1, ''} end
end
for i = 1, n do
  if redis.call('SET', KEYS[i], value, 'NX', 'PX', ttl) then return {i - 1, ''} end
end
if takeover == '1' then
  local oldest, oldestTs = nil, nil
  for i = 1, n do
    local v = redis.call('GET', KEYS[i])
    local ts = tonumber(string.match(v, ':(%d+)$'))
    if oldestTs == nil or ts < oldestTs then oldest = i; oldestTs = ts end
  end
  local stolen = string.match(redis.call('GET', KEYS[oldest]), '^(%d+):')
  redis.call('SET', KEYS[oldest], value, 'PX', ttl)
  return {oldest - 1, stolen}
end
return {-1, ''}`;

export async function acquireSlot(accountId: number, maxStreams: number, deviceId: number, leaseMs: number, takeover: boolean): Promise<{ slot: number; stolenDevice: number | null }> {
  const keys = Array.from({ length: maxStreams }, (_, i) => slotKey(accountId, i));
  const [slot, stolen] = (await getRedis().eval(ACQUIRE, keys.length, ...keys, String(maxStreams), String(deviceId), `${deviceId}:${Date.now()}`, String(leaseMs), takeover ? '1' : '0')) as [number, string];
  return { slot, stolenDevice: stolen ? Number(stolen) : null };
}

/** Frees this device's slot(s) for the account. */
export async function freeSlots(accountId: number, deviceIds: number[]): Promise<void> {
  if (!inUse) return;
  const r = getRedis();
  for (let i = 0; i < MAX_SLOTS; i++) {
    const v = await r.get(slotKey(accountId, i));
    const dev = v ? Number(v.split(':')[0]) : null;
    if (dev !== null && deviceIds.includes(dev)) await r.del(slotKey(accountId, i));
  }
}
export const freeAllSlots = async (accountId: number) => {
  if (!inUse) return;
  const r = getRedis();
  for (let i = 0; i < MAX_SLOTS; i++) await r.del(slotKey(accountId, i));
};

/** Heartbeat: extend this device's slot lease. */
export async function extendSlot(accountId: number, deviceId: number, leaseMs: number): Promise<void> {
  if (!inUse) return;
  const r = getRedis();
  for (let i = 0; i < MAX_SLOTS; i++) {
    const v = await r.get(slotKey(accountId, i));
    if (v && Number(v.split(':')[0]) === deviceId) { await r.pexpire(slotKey(accountId, i), leaseMs); return; }
  }
}

/** Lab reset: remove every slot key. */
export async function flushSlots(): Promise<void> {
  const r = getRedis();
  const keys = await r.keys('playsync:slot:*');
  if (keys.length) await r.del(...keys);
}
