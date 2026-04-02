import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';

type QueueConnection = {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
};

@Injectable()
export class CacheQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheQueueService.name);
  private readonly ttlSeconds: number;
  private cacheClient: Redis | null = null;
  private queueConnection: QueueConnection | null = null;
  private readonly queues = new Map<string, Queue>();
  private isAvailable = false;

  constructor(private readonly configService: ConfigService) {
    this.ttlSeconds = this.configService.get<number>('cache.ttlSeconds', 300);
  }

  async onModuleInit() {
    const redisUrl =
      this.configService.get<string>('cache.redisUrl') ?? 'redis://localhost:6379';

    try {
      const parsedRedisUrl = new URL(redisUrl);
      this.queueConnection = {
        host: parsedRedisUrl.hostname,
        port: Number(parsedRedisUrl.port || 6379),
        password: parsedRedisUrl.password || undefined,
        db: parsedRedisUrl.pathname
          ? Number(parsedRedisUrl.pathname.replace('/', '') || 0)
          : 0,
        maxRetriesPerRequest: null,
      };

      this.cacheClient = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      await this.cacheClient.connect();
      this.isAvailable = true;
      this.logger.log('Redis conectado. Cache e filas ativos.');
    } catch (error) {
      this.logger.warn(
        'Redis nao disponivel. Cache e filas seguirao em modo degradado.',
      );
    }
  }

  async onModuleDestroy() {
    await Promise.all([
      ...Array.from(this.queues.values()).map((queue) => queue.close()),
      this.cacheClient?.quit(),
    ]);
  }

  isReady() {
    return this.isAvailable;
  }

  getQueueConnection() {
    return this.queueConnection;
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.isAvailable || !this.cacheClient) {
      return null;
    }

    const rawValue = await this.cacheClient.get(key);
    return rawValue ? (JSON.parse(rawValue) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    if (!this.isAvailable || !this.cacheClient) {
      return;
    }

    await this.cacheClient.set(
      key,
      JSON.stringify(value),
      'EX',
      ttlSeconds ?? this.ttlSeconds,
    );
  }

  async del(key: string) {
    if (!this.isAvailable || !this.cacheClient) {
      return;
    }

    await this.cacheClient.del(key);
  }

  async hitRateLimitWindow(
    key: string,
    windowMs: number,
  ): Promise<{ hits: number; resetAfterMs: number } | null> {
    if (!this.isAvailable || !this.cacheClient) {
      return null;
    }

    const hits = await this.cacheClient.incr(key);

    if (hits === 1) {
      await this.cacheClient.pexpire(key, windowMs);
    }

    const ttl = await this.cacheClient.pttl(key);

    return {
      hits,
      resetAfterMs: ttl > 0 ? ttl : windowMs,
    };
  }

  async invalidateByPrefix(prefix: string) {
    if (!this.isAvailable || !this.cacheClient) {
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.cacheClient.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        '100',
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.cacheClient.del(...keys);
      }
    } while (cursor !== '0');
  }

  async enqueue(
    queueName: string,
    jobName: string,
    payload: Record<string, unknown>,
    options?: JobsOptions,
  ) {
    if (!this.isAvailable || !this.queueConnection) {
      return;
    }

    let queue = this.queues.get(queueName);

    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.queueConnection,
      });
      this.queues.set(queueName, queue);
    }

    await queue.add(jobName, payload, {
      removeOnComplete: true,
      removeOnFail: 50,
      ...options,
    });
  }
}
