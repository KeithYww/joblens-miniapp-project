import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

let redisConnected = false;

export const redis = new Redis(redisUrl, {
  lazyConnect: true,
  retryStrategy: () => {
    redisConnected = false;
    return null; // don't retry
  },
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on('error', () => {
  redisConnected = false;
});

redis.on('connect', () => {
  redisConnected = true;
});

redis.on('ready', () => {
  redisConnected = true;
});

redis.on('close', () => {
  redisConnected = false;
});

export function isRedisAvailable(): boolean {
  return redisConnected && redis.status === 'ready';
}

export async function initRedis() {
  try {
    await redis.connect();
    await redis.ping();
    redisConnected = true;
  } catch (err) {
    console.error('Failed to connect to Redis, using memory fallback:', (err as Error).message);
    redisConnected = false;
  }
}
