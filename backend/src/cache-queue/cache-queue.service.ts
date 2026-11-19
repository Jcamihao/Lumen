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

type CacheStatus = 'idle' | 'up' | 'down';

// Limites de tempo: nenhuma chamada ao Redis pode pendurar a requisicao.
const COMMAND_TIMEOUT_MS = 1500;
const INVALIDATE_TIMEOUT_MS = 5000;
const ENQUEUE_TIMEOUT_MS = 2000;
const CLOSE_TIMEOUT_MS = 1000;

// INCR, PTTL e PEXPIRE no mesmo script: rodam atomicos no Redis, entao a chave nao
// fica sem expiracao se o PEXPIRE falhar. Expira na primeira batida ou se a chave ficou sem TTL.
const RATE_LIMIT_WINDOW_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);
const CONNECTION_ERROR_MESSAGE = /Connection is closed|Stream isn't writeable/i;

class CacheTimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'CacheTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CacheTimeoutError()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// So o codigo ou o nome do erro: mensagens do Redis podem trazer chave, valor ou URL.
function errorReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code)) {
    return code;
  }
  return error instanceof Error ? error.name : 'erro';
}

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  return error instanceof Error && CONNECTION_ERROR_MESSAGE.test(error.message);
}

@Injectable()
export class CacheQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheQueueService.name);
  private readonly ttlSeconds: number;
  private cacheClient: Redis | null = null;
  private queueConnection: QueueConnection | null = null;
  private readonly queues = new Map<string, Queue>();
  private status: CacheStatus = 'idle';
  private closing = false;

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
    } catch {
      this.logger.warn(
        'URL do Redis invalida. Cache e filas seguirao em modo degradado.',
      );
      return;
    }

    // Sem fila offline: comando com Redis fora falha na hora, em vez de pendurar.
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: COMMAND_TIMEOUT_MS,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.cacheClient = client;

    client.on('ready', () => this.setStatus('up'));
    client.on('close', () => this.setStatus('down', 'conexao fechada'));
    client.on('end', () => this.setStatus('down', 'conexao encerrada'));
    client.on('error', (error: unknown) => this.setStatus('down', errorReason(error)));

    // Nao aguarda: o boot segue mesmo com Redis fora; a reconexao e automatica.
    client.connect().catch((error: unknown) => this.setStatus('down', errorReason(error)));
  }

  async onModuleDestroy() {
    this.closing = true;
    this.status = 'down';

    const queues = Array.from(this.queues.values());
    this.queues.clear();
    await Promise.all(
      queues.map((queue) =>
        this.settle('fechar fila', () => withTimeout(queue.close(), CLOSE_TIMEOUT_MS)),
      ),
    );

    const client = this.cacheClient;
    this.cacheClient = null;
    if (client) {
      try {
        await withTimeout(client.quit(), CLOSE_TIMEOUT_MS);
      } catch {
        client.disconnect();
      }
    }
  }

  isReady() {
    return this.status === 'up';
  }

  getQueueConnection() {
    return this.queueConnection;
  }

  async getJson<T>(key: string): Promise<T | null> {
    return this.runCommand<T | null>('getJson', null, async (client) => {
      const rawValue = await client.get(key);
      return rawValue ? (JSON.parse(rawValue) as T) : null;
    });
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    await this.runCommand<void>('setJson', undefined, async (client) => {
      await client.set(
        key,
        JSON.stringify(value),
        'EX',
        ttlSeconds ?? this.ttlSeconds,
      );
    });
  }

  async del(key: string) {
    await this.runCommand<void>('del', undefined, async (client) => {
      await client.del(key);
    });
  }

  async hitRateLimitWindow(
    key: string,
    windowMs: number,
  ): Promise<{ hits: number; resetAfterMs: number } | null> {
    return this.runCommand<{ hits: number; resetAfterMs: number } | null>(
      'hitRateLimitWindow',
      null,
      async (client) => {
        const [hits, ttl] = (await client.eval(
          RATE_LIMIT_WINDOW_SCRIPT,
          1,
          key,
          windowMs,
        )) as [number, number];

        return {
          hits: Number(hits),
          resetAfterMs: ttl > 0 ? ttl : windowMs,
        };
      },
    );
  }

  async invalidateByPrefix(prefix: string) {
    await this.runCommand<void>(
      'invalidateByPrefix',
      undefined,
      async (client) => {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await client.scan(
            cursor,
            'MATCH',
            `${prefix}*`,
            'COUNT',
            '100',
          );
          cursor = nextCursor;

          if (keys.length > 0) {
            await client.del(...keys);
          }
        } while (cursor !== '0');
      },
      INVALIDATE_TIMEOUT_MS,
    );
  }

  async enqueue(
    queueName: string,
    jobName: string,
    payload: Record<string, unknown>,
    options?: JobsOptions,
  ) {
    await this.runCommand<void>(
      'enqueue',
      undefined,
      async () => {
        const connection = this.queueConnection;
        if (!connection) {
          return;
        }

        let queue = this.queues.get(queueName);

        if (!queue) {
          queue = new Queue(queueName, { connection });
          // Sem listener, erro de conexao da fila derruba o processo.
          queue.on('error', (error: unknown) =>
            this.logger.debug(`Fila em erro de conexao: ${errorReason(error)}`),
          );
          this.queues.set(queueName, queue);
        }

        await queue.add(jobName, payload, {
          removeOnComplete: true,
          removeOnFail: 50,
          ...options,
        });
      },
      ENQUEUE_TIMEOUT_MS,
    );
  }

  // Executa um comando com limite de tempo. Com Redis fora ou erro/timeout, devolve o
  // valor degradado e nunca propaga excecao.
  private async runCommand<T>(
    operation: string,
    fallback: T,
    command: (client: Redis) => Promise<T>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    const client = this.cacheClient;
    if (!this.isReady() || !client) {
      return fallback;
    }

    try {
      return await withTimeout(command(client), timeoutMs);
    } catch (error) {
      const reason = errorReason(error);
      this.logger.warn(
        `Operacao de cache falhou (${operation}: ${reason}). Usando modo degradado.`,
      );
      if (isConnectionError(error)) {
        this.setStatus('down', reason);
      }
      return fallback;
    }
  }

  // Loga so na transicao de estado, nunca a cada tentativa de reconexao.
  private setStatus(next: 'up' | 'down', reason = 'desconhecido') {
    if (this.closing || this.status === next) {
      return;
    }

    const previous = this.status;
    this.status = next;

    if (next === 'up') {
      this.logger.log(
        previous === 'down'
          ? 'Redis reconectado. Cache e filas ativos.'
          : 'Redis conectado. Cache e filas ativos.',
      );
      return;
    }

    this.logger.warn(
      previous === 'idle'
        ? `Redis nao disponivel no boot (${reason}). Cache e filas em modo degradado ate reconectar.`
        : `Redis indisponivel (${reason}). Cache e filas em modo degradado.`,
    );
  }

  private async settle(label: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch {
      this.logger.warn(`Falha ao ${label} no encerramento. Ignorado.`);
    }
  }
}
