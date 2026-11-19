import { Logger } from '@nestjs/common';
import { CacheQueueService } from './cache-queue.service';

const REDIS_URL = 'redis://:s3cr3t-pass@cache.internal:6380/1';

jest.mock('ioredis', () => {
  const { EventEmitter } = require('events');

  class FakeRedis extends EventEmitter {
    static instances: FakeRedis[] = [];
    static connectBehavior: 'ready' | 'reject' = 'ready';

    readonly url: string;
    readonly options: Record<string, unknown>;

    connect = jest.fn(() => {
      if (FakeRedis.connectBehavior === 'reject') {
        return Promise.reject(Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }));
      }
      this.emit('ready');
      return Promise.resolve();
    });
    get = jest.fn();
    set = jest.fn();
    del = jest.fn();
    scan = jest.fn();
    eval = jest.fn();
    incr = jest.fn();
    pexpire = jest.fn();
    pttl = jest.fn();
    quit = jest.fn(() => Promise.resolve('OK'));
    disconnect = jest.fn();

    constructor(url: string, options: Record<string, unknown>) {
      super();
      this.url = url;
      this.options = options;
      FakeRedis.instances.push(this);
    }
  }

  return { __esModule: true, default: FakeRedis };
});

jest.mock('bullmq', () => {
  const { EventEmitter } = require('events');

  class FakeQueue extends EventEmitter {
    static instances: FakeQueue[] = [];
    static addImpl: () => Promise<unknown> = () => Promise.resolve({ id: '1' });

    readonly name: string;
    readonly opts: unknown;

    add = jest.fn(() => FakeQueue.addImpl());
    close = jest.fn(() => Promise.resolve());

    constructor(name: string, opts: unknown) {
      super();
      this.name = name;
      this.opts = opts;
      FakeQueue.instances.push(this);
    }
  }

  return { Queue: FakeQueue };
});

const RedisMock = (jest.requireMock('ioredis') as any).default;
const QueueMock = (jest.requireMock('bullmq') as any).Queue;

const makeConfig = (url = REDIS_URL) =>
  ({
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'cache.redisUrl') return url;
      if (key === 'cache.ttlSeconds') return 300;
      return fallback;
    }),
  }) as any;

async function boot(connect: 'ready' | 'reject' = 'ready', url?: string) {
  RedisMock.connectBehavior = connect;
  const service = new CacheQueueService(makeConfig(url));
  await service.onModuleInit();
  const client = RedisMock.instances[RedisMock.instances.length - 1];
  return { service, client };
}

const neverSettles = () => new Promise<never>(() => undefined);

describe('CacheQueueService', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    RedisMock.instances = [];
    RedisMock.connectBehavior = 'ready';
    QueueMock.instances = [];
    QueueMock.addImpl = () => Promise.resolve({ id: '1' });
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('(a) com Redis ok: cache e rate limit funcionam', async () => {
    const { service, client } = await boot();

    expect(service.isReady()).toBe(true);

    client.get.mockResolvedValue(JSON.stringify({ a: 1 }));
    await expect(service.getJson('k')).resolves.toEqual({ a: 1 });
    expect(client.get).toHaveBeenCalledWith('k');

    await service.setJson('k', { a: 1 });
    expect(client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 300);

    client.eval.mockResolvedValue([3, 5000]);
    await expect(service.hitRateLimitWindow('rl', 60_000)).resolves.toEqual({
      hits: 3,
      resetAfterMs: 5000,
    });
  });

  it('(b) cliente emite close: isReady false e metodos devolvem degradado sem chamar o cliente', async () => {
    const { service, client } = await boot();

    client.emit('close');
    expect(service.isReady()).toBe(false);

    await expect(service.getJson('k')).resolves.toBeNull();
    await expect(service.setJson('k', 1)).resolves.toBeUndefined();
    await expect(service.del('k')).resolves.toBeUndefined();
    await expect(service.hitRateLimitWindow('rl', 1000)).resolves.toBeNull();
    await expect(service.invalidateByPrefix('p:')).resolves.toBeUndefined();
    await expect(
      service.enqueue('fila', 'job', { x: 1 }),
    ).resolves.toBeUndefined();

    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
    expect(client.eval).not.toHaveBeenCalled();
    expect(client.scan).not.toHaveBeenCalled();
    expect(QueueMock.instances).toHaveLength(0);
  });

  it('(c) cliente emite ready de novo: volta a funcionar e loga reconexao', async () => {
    const { service, client } = await boot();

    client.emit('close');
    client.emit('ready');

    expect(service.isReady()).toBe(true);
    client.get.mockResolvedValue(JSON.stringify('ok'));
    await expect(service.getJson('k')).resolves.toBe('ok');
    expect(logSpy).toHaveBeenCalledWith('Redis reconectado. Cache e filas ativos.');
  });

  it('(d) comando que rejeita: degradado sem excecao; erro de conexao derruba o status', async () => {
    const { service, client } = await boot();

    client.get.mockRejectedValueOnce(new Error('WRONGTYPE Operation against a key'));
    await expect(service.getJson('k')).resolves.toBeNull();
    expect(service.isReady()).toBe(true);

    client.get.mockResolvedValueOnce('{invalido');
    await expect(service.getJson('k')).resolves.toBeNull();
    expect(service.isReady()).toBe(true);

    client.get.mockRejectedValueOnce(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    );
    await expect(service.getJson('k')).resolves.toBeNull();
    expect(service.isReady()).toBe(false);
  });

  it('(d2) erro de conexao reconhecido pela mensagem (sem codigo) tambem derruba o status', async () => {
    const { service, client } = await boot();

    client.get.mockRejectedValueOnce(new Error('Connection is closed.'));
    await expect(service.getJson('k')).resolves.toBeNull();
    expect(service.isReady()).toBe(false);
  });

  it('(e) comando que nunca resolve: degradado dentro do limite de tempo', async () => {
    const { service, client } = await boot();
    jest.useFakeTimers();

    client.get.mockReturnValue(neverSettles());
    const cached = service.getJson('k');
    await jest.advanceTimersByTimeAsync(1500);
    await expect(cached).resolves.toBeNull();

    client.eval.mockReturnValue(neverSettles());
    const limited = service.hitRateLimitWindow('rl', 1000);
    await jest.advanceTimersByTimeAsync(1500);
    await expect(limited).resolves.toBeNull();

    // Dois timeouts seguidos: Redis pendurado, vira degradado (ver testes do breaker).
    expect(service.isReady()).toBe(false);
  });

  describe('breaker de timeouts (Redis pendurado, conexao aberta)', () => {
    async function twoTimeouts(service: CacheQueueService, client: any) {
      client.get.mockReturnValue(neverSettles());
      for (let i = 0; i < 2; i++) {
        const p = service.getJson('k');
        await jest.advanceTimersByTimeAsync(1500);
        await p;
      }
    }

    it('um timeout isolado nao derruba o status; sucesso zera a contagem', async () => {
      const { service, client } = await boot();
      jest.useFakeTimers();

      client.get.mockReturnValueOnce(neverSettles());
      const p = service.getJson('k');
      await jest.advanceTimersByTimeAsync(1500);
      await p;
      expect(service.isReady()).toBe(true);

      client.get.mockResolvedValueOnce(null);
      await service.getJson('k');
      client.get.mockReturnValueOnce(neverSettles());
      const p2 = service.getJson('k');
      await jest.advanceTimersByTimeAsync(1500);
      await p2;
      expect(service.isReady()).toBe(true);
    });

    it('dois timeouts seguidos: degradado imediato, sem chamar o cliente, 1 log de transicao', async () => {
      const { service, client } = await boot();
      jest.useFakeTimers();
      await twoTimeouts(service, client);

      expect(service.isReady()).toBe(false);
      client.get.mockClear();
      const t0 = Date.now();
      await expect(service.getJson('k')).resolves.toBeNull();
      await expect(service.hitRateLimitWindow('rl', 1000)).resolves.toBeNull();
      expect(Date.now() - t0).toBe(0);
      expect(client.get).not.toHaveBeenCalled();
      const downLogs = warnSpy.mock.calls.filter((c) => /indisponivel/.test(String(c[0])));
      expect(downLogs).toHaveLength(1);
    });

    it('depois do intervalo uma sonda testa o Redis; sucesso volta a up com log de reconexao', async () => {
      const { service, client } = await boot();
      jest.useFakeTimers();
      await twoTimeouts(service, client);

      await jest.advanceTimersByTimeAsync(4999);
      client.get.mockClear();
      await service.getJson('k');
      expect(client.get).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      client.get.mockResolvedValue(JSON.stringify({ ok: 1 }));
      await expect(service.getJson('k')).resolves.toEqual({ ok: 1 });
      expect(service.isReady()).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('reconectado'));
    });

    it('sonda que falha reagenda a proxima e so uma sonda roda por vez', async () => {
      const { service, client } = await boot();
      jest.useFakeTimers();
      await twoTimeouts(service, client);

      await jest.advanceTimersByTimeAsync(5000);
      client.get.mockClear();
      const probe = service.getJson('k');
      const other = service.getJson('k'); // concorrente: nao e sonda
      await expect(other).resolves.toBeNull();
      expect(client.get).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1500);
      await probe;
      expect(service.isReady()).toBe(false);

      client.get.mockClear();
      await service.getJson('k');
      expect(client.get).not.toHaveBeenCalled(); // reagendada, ainda nao passou o intervalo
      await jest.advanceTimersByTimeAsync(5000);
      client.get.mockResolvedValue(null);
      await service.getJson('k');
      expect(client.get).toHaveBeenCalledTimes(1);
      expect(service.isReady()).toBe(true);
    });

    it('close apos o breaker cancela a sonda; ready do cliente volta a up', async () => {
      const { service, client } = await boot();
      jest.useFakeTimers();
      await twoTimeouts(service, client);

      client.emit('close');
      await jest.advanceTimersByTimeAsync(10_000);
      client.get.mockClear();
      await service.getJson('k');
      expect(client.get).not.toHaveBeenCalled(); // sem sonda: espera o ready do ioredis

      client.emit('ready');
      expect(service.isReady()).toBe(true);
      client.get.mockResolvedValue(null);
      await service.getJson('k');
      expect(client.get).toHaveBeenCalledTimes(1);
    });

    it('sonda que falha nao gera warn por chamada (log so na transicao)', async () => {
      const { service, client } = await boot();
      jest.useFakeTimers();
      await twoTimeouts(service, client);
      warnSpy.mockClear();

      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(5000);
        const probe = service.getJson('k');
        await jest.advanceTimersByTimeAsync(1500);
        await probe;
      }
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('timeout do proprio ioredis (Command timed out) tambem conta', async () => {
      const { service, client } = await boot();
      client.get.mockRejectedValue(new Error('Command timed out'));
      await service.getJson('k');
      await service.getJson('k');
      expect(service.isReady()).toBe(false);
    });
  });

  it('(f) boot com connect rejeitando: sem excecao, isReady false; depois de ready passa a funcionar', async () => {
    const { service, client } = await boot('reject');

    expect(service.isReady()).toBe(false);
    await expect(service.getJson('k')).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'Redis nao disponivel no boot (ECONNREFUSED). Cache e filas em modo degradado ate reconectar.',
    );

    client.emit('ready');
    expect(service.isReady()).toBe(true);
    client.get.mockResolvedValue(JSON.stringify(7));
    await expect(service.getJson('k')).resolves.toBe(7);
  });

  it('(g) rate limit: script unico com INCR, PTTL e PEXPIRE; falha do script devolve null sem comandos soltos', async () => {
    const { service, client } = await boot();

    client.eval.mockResolvedValueOnce([1, 60_000]);
    await expect(service.hitRateLimitWindow('rl', 60_000)).resolves.toEqual({
      hits: 1,
      resetAfterMs: 60_000,
    });

    const [script, numKeys, key, windowMs] = client.eval.mock.calls[0];
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('PTTL'");
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(numKeys).toBe(1);
    expect(key).toBe('rl');
    expect(windowMs).toBe(60_000);

    client.eval.mockRejectedValueOnce(new Error('NOSCRIPT'));
    await expect(service.hitRateLimitWindow('rl', 60_000)).resolves.toBeNull();

    expect(client.incr).not.toHaveBeenCalled();
    expect(client.pexpire).not.toHaveBeenCalled();
    expect(client.pttl).not.toHaveBeenCalled();
  });

  it('(h) enqueue pendurado: volta dentro do limite de tempo', async () => {
    const { service } = await boot();
    jest.useFakeTimers();
    QueueMock.addImpl = neverSettles;

    let settled = false;
    const pending = service.enqueue('fila', 'job', { x: 1 }).then(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(1600);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(QueueMock.instances).toHaveLength(1);
  });

  it('(i) onModuleDestroy com Redis fora nao pendura e usa disconnect', async () => {
    const { service, client } = await boot();
    client.emit('close');
    client.quit.mockRejectedValueOnce(new Error("Stream isn't writeable"));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);

    // Depois do encerramento, evento de ready nao reativa nem loga.
    logSpy.mockClear();
    client.emit('ready');
    expect(service.isReady()).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('(k) enqueue com sucesso nao deixa timer pendente', async () => {
    const { service } = await boot();
    jest.useFakeTimers();

    await service.enqueue('fila', 'job', { x: 1 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(i2) onModuleDestroy com quit que nunca responde: limite de tempo e disconnect', async () => {
    const { service, client } = await boot();
    jest.useFakeTimers();
    client.quit.mockReturnValueOnce(neverSettles());

    const closing = service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(closing).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('(i3) onModuleDestroy com Redis ok faz quit e nao propaga erro de fila', async () => {
    const { service, client } = await boot();
    await service.enqueue('fila', 'job', { x: 1 });
    QueueMock.instances[0].close.mockRejectedValueOnce(new Error('falha ao fechar'));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(QueueMock.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('(j) logs nao contem URL, senha nem host do Redis', async () => {
    const { service, client } = await boot();

    client.get.mockRejectedValueOnce(new Error(`falha em ${REDIS_URL}`));
    await service.getJson('chave-do-usuario');
    client.emit(
      'error',
      Object.assign(new Error('connect ECONNREFUSED cache.internal:6380 s3cr3t-pass'), {
        code: 'ECONNREFUSED',
      }),
    );

    const logged = JSON.stringify([
      warnSpy.mock.calls,
      logSpy.mock.calls,
      debugSpy.mock.calls,
      errorSpy.mock.calls,
    ]);
    expect(logged).not.toContain('s3cr3t-pass');
    expect(logged).not.toContain('cache.internal');
    expect(logged).not.toContain('redis://');
    expect(logged).not.toContain('chave-do-usuario');
    expect(logged).toContain('ECONNREFUSED');
  });

  it('log de indisponibilidade sai uma vez por transicao, nao a cada tentativa', async () => {
    const { client } = await boot();

    client.emit('close');
    client.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    client.emit('close');
    client.emit('end');

    const downLogs = warnSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith('Redis indisponivel'),
    );
    expect(downLogs).toHaveLength(1);
  });

  it('configura o cliente sem fila offline, com timeout curto e backoff de reconexao', async () => {
    const { client } = await boot();

    expect(client.options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1500,
    });
    const retry = (client.options as { retryStrategy: (n: number) => number }).retryStrategy;
    expect(retry(1)).toBe(200);
    expect(retry(3)).toBe(600);
    expect(retry(100)).toBe(5000);
  });

  it('mantem maxRetriesPerRequest null na conexao das filas (workers do BullMQ)', async () => {
    const { service } = await boot();

    expect(service.getQueueConnection()).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      db: 1,
      maxRetriesPerRequest: null,
    });
  });

  it('URL invalida: boot nao quebra e nenhum cliente e criado', async () => {
    RedisMock.instances = [];
    const service = new CacheQueueService(makeConfig('nao-e-url'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isReady()).toBe(false);
    expect(RedisMock.instances).toHaveLength(0);
  });
});
