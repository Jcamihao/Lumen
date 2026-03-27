import { registerAs } from '@nestjs/config';

export const cacheConfig = registerAs('cache', () => ({
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS ?? '300', 10),
}));
