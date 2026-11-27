import { appConfig } from '../config/app.config';

type Call = unknown[];

const mockCalls: Call[] = [];
const mockCreate = jest.fn();

jest.mock('@nestjs/core', () => ({
  NestFactory: { create: (...args: unknown[]) => mockCreate(...args) },
}));

jest.mock('../app.module', () => ({ AppModule: class AppModule {} }));

jest.mock('express', () => {
  const mockActual = jest.requireActual('express');
  return Object.assign(mockActual, {
    json: (options: unknown) => mockTagged('json', options),
    urlencoded: (options: unknown) => mockTagged('urlencoded', options),
  });
});

jest.mock('helmet', () => ({ __esModule: true, default: () => mockTagged('helmet') }));

jest.mock('compression', () => () => mockTagged('compression'));

jest.mock('@nestjs/swagger', () => {
  class DocumentBuilder {
    setTitle(title: string) {
      mockCalls.push(['DocumentBuilder.setTitle', title]);
      return this;
    }
    setDescription(description: string) {
      mockCalls.push(['DocumentBuilder.setDescription', description]);
      return this;
    }
    setVersion(version: string) {
      mockCalls.push(['DocumentBuilder.setVersion', version]);
      return this;
    }
    addBearerAuth() {
      mockCalls.push(['DocumentBuilder.addBearerAuth']);
      return this;
    }
    build() {
      mockCalls.push(['DocumentBuilder.build']);
      return { mockDocumentConfig: true };
    }
  }
  return {
    DocumentBuilder,
    SwaggerModule: {
      createDocument: (_app: unknown, config: unknown) => {
        mockCalls.push(['SwaggerModule.createDocument', config]);
        return { mockDocument: true };
      },
      setup: (path: string, _app: unknown, document: unknown, options: unknown) => {
        mockCalls.push(['SwaggerModule.setup', path, document, options]);
      },
    },
  };
});

function mockTagged(name: string, options?: unknown) {
  const middleware = () => undefined;
  Object.defineProperty(middleware, 'name', { value: name });
  Object.assign(middleware, { options });
  return middleware;
}

const TRACKED_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'HOST',
  'APP_URL',
  'APP_CORS_ALLOWED_ORIGINS',
  'APP_SWAGGER_ENABLED',
];
const ORIGINAL_ENV = { ...process.env };

function record(...args: unknown[]) {
  mockCalls.push(args);
}

function fakeConfigService() {
  const lookup = (path: string) =>
    path.split('.').slice(1).reduce<any>((node, key) => node?.[key], appConfig());
  return {
    get: (path: string, fallback?: unknown) => lookup(path) ?? fallback,
  } as unknown as { get: (path: string, fallback?: unknown) => unknown };
}

function fakeApp() {
  const httpInstance = {
    set: (...args: unknown[]) => {
      record('httpAdapter.set', ...args);
      return httpInstance;
    },
  };
  return {
    getHttpAdapter: () => ({ getInstance: () => httpInstance }),
    get: (token: { name?: string }) => (token?.name === 'ConfigService' ? fakeConfigService() : undefined),
    enableShutdownHooks: () => record('enableShutdownHooks'),
    setGlobalPrefix: (prefix: string) => record('setGlobalPrefix', prefix),
    use: (middleware: unknown) => record('use', middleware),
    enableCors: (options: unknown) => record('enableCors', options),
    useGlobalPipes: (pipe: unknown) => record('useGlobalPipes', pipe),
    useGlobalFilters: (filter: unknown) => record('useGlobalFilters', filter),
    listen: async (port: unknown, host: unknown) => record('listen', port, host),
  };
}

function setEnv(overrides: Record<string, string>) {
  process.env = { ...ORIGINAL_ENV, ...overrides };
  for (const key of TRACKED_ENV_KEYS) {
    if (!(key in overrides)) delete process.env[key];
  }
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

let activeLoggerProto: any;

async function runMain(overrides: Record<string, string>): Promise<Call[]> {
  setEnv(overrides);
  jest.resetModules();
  const { Logger } = require('@nestjs/common');
  activeLoggerProto = Logger.prototype;
  jest.spyOn(activeLoggerProto, 'log').mockImplementation((message: unknown) => {
    record('logger.log', message);
  });
  mockCreate.mockResolvedValue(fakeApp());
  require('../main');
  await flushAsync();
  return mockCalls.map((call) => [...call]);
}

function usesOf(calls: Call[]): Array<(...args: any[]) => any> {
  return calls.filter(([name]) => name === 'use').map(([, middleware]) => middleware as any);
}

function findCall(calls: Call[], name: string): any[] {
  const found = calls.find(([callName]) => callName === name);
  if (!found) throw new Error(`call ${name} not recorded`);
  return found.slice(1);
}

describe('main.ts bootstrap (caracterizacao)', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockCreate.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('sequencia de chamadas em development (swagger ligado por padrao)', async () => {
    expect(await runMain({ NODE_ENV: 'development' })).toMatchSnapshot();
  });

  it('sequencia de chamadas em production (swagger desligado por padrao)', async () => {
    expect(await runMain({ NODE_ENV: 'production' })).toMatchSnapshot();
  });

  it('production com APP_SWAGGER_ENABLED=true liga o swagger', async () => {
    expect(
      await runMain({ NODE_ENV: 'production', APP_SWAGGER_ENABLED: 'true' }),
    ).toMatchSnapshot();
  });

  it('usa PORT, HOST, APP_URL e lista de CORS do ambiente', async () => {
    expect(
      await runMain({
        NODE_ENV: 'production',
        PORT: '8080',
        HOST: '127.0.0.1',
        APP_URL: 'https://api.exemplo.com',
        APP_CORS_ALLOWED_ORIGINS: ' https://app.exemplo.com , https://m.exemplo.com ',
      }),
    ).toMatchSnapshot();
  });

  it('ouve na porta e host configurados e loga a URL com o prefixo api/v1', async () => {
    const calls = await runMain({ NODE_ENV: 'development' });
    expect(findCall(calls, 'listen')).toEqual([3000, '0.0.0.0']);
    expect(calls).toContainEqual(['logger.log', 'LUMEN API running at http://localhost:3000/api/v1']);
  });

  it('registra prefixo global, trust proxy e shutdown hooks antes dos middlewares', async () => {
    const calls = await runMain({ NODE_ENV: 'development' });
    const names = calls.map(([name]) => name);
    expect(names.indexOf('httpAdapter.set')).toBeLessThan(names.indexOf('enableShutdownHooks'));
    expect(names.indexOf('enableShutdownHooks')).toBeLessThan(names.indexOf('setGlobalPrefix'));
    expect(findCall(calls, 'httpAdapter.set')).toEqual(['trust proxy', 1]);
    expect(findCall(calls, 'setGlobalPrefix')).toEqual(['api/v1']);
  });

  it('ordem dos middlewares: trace, json, urlencoded, helmet, compression', async () => {
    const calls = await runMain({ NODE_ENV: 'development' });
    const names = usesOf(calls).map((middleware) => middleware.name || 'trace');
    expect(names).toEqual(['trace', 'json', 'urlencoded', 'helmet', 'compression']);
  });

  it('CORS: origem da lista e requisicao sem origem passam; origem de fora nao recebe cabecalhos', async () => {
    const calls = await runMain({ NODE_ENV: 'development' });
    const cors = findCall(calls, 'enableCors')[0];
    expect(cors.credentials).toBe(true);
    const check = (origin: string | undefined) => {
      const callback = jest.fn();
      cors.origin(origin, callback);
      return callback.mock.calls;
    };
    expect(check('http://localhost:4200')).toEqual([[null, true]]);
    expect(check(undefined)).toEqual([[null, true]]);
    expect(check('https://estranha.exemplo.com')).toEqual([[null, false]]);
  });

  it('json guarda o corpo bruto so no webhook do WhatsApp', async () => {
    const calls = await runMain({ NODE_ENV: 'development' });
    const jsonMiddleware = usesOf(calls)[1] as any;
    expect(jsonMiddleware.options.limit).toBe('5mb');
    const buf = Buffer.from('{}');
    const webhookReq: any = { originalUrl: '/api/v1/whatsapp/webhook' };
    jsonMiddleware.options.verify(webhookReq, undefined, buf);
    expect(webhookReq.rawBody).toBe(buf);
    const otherReq: any = { originalUrl: '/api/v1/tarefas' };
    jsonMiddleware.options.verify(otherReq, undefined, buf);
    expect(otherReq.rawBody).toBeUndefined();
  });

  describe('middleware de trace de requisicao', () => {
    const requestLog = (statusCode: number, user?: { sub: string }, headers: Record<string, string> = {}) => {
      const handlers: Record<string, () => void> = {};
      const req: any = {
        header: (name: string) => headers[name.toLowerCase()],
        method: 'GET',
        originalUrl: '/api/v1/tarefas',
        url: '/tarefas',
        user,
      };
      const res: any = {
        statusCode,
        setHeader: jest.fn(),
        on: (event: string, handler: () => void) => (handlers[event] = handler),
      };
      const next = jest.fn();
      return { req, res, next, handlers };
    };

    async function traceMiddleware() {
      const calls = await runMain({ NODE_ENV: 'development' });
      return usesOf(calls)[0];
    }

    it('usa o x-request-id recebido (sem espacos) e devolve o cabecalho', async () => {
      const trace = await traceMiddleware();
      const { req, res, next } = requestLog(200, undefined, { 'x-request-id': '  abc-123  ' });
      trace(req, res, next);
      expect(req.requestId).toBe('abc-123');
      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('gera UUID quando o cabecalho esta ausente ou so com espacos', async () => {
      const trace = await traceMiddleware();
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      const absent = requestLog(200);
      trace(absent.req, absent.res, absent.next);
      expect(absent.req.requestId).toMatch(uuid);
      const blank = requestLog(200, undefined, { 'x-request-id': '   ' });
      trace(blank.req, blank.res, blank.next);
      expect(blank.req.requestId).toMatch(uuid);
    });

    it.each([
      [200, 'log'],
      [400, 'warn'],
      [404, 'warn'],
      [500, 'error'],
    ])('status %i loga no nivel %s ao terminar', async (statusCode, level) => {
      const trace = await traceMiddleware();
      const spy = jest.spyOn(activeLoggerProto, level as 'log').mockImplementation(() => undefined);
      const { req, res, next, handlers } = requestLog(statusCode, { sub: 'user-9' }, { 'x-request-id': 'rid-1' });
      trace(req, res, next);
      handlers.finish();
      const completed = spy.mock.calls.filter(([message]) => String(message).startsWith('request_completed'));
      expect(completed).toHaveLength(1);
      expect(completed[0][0]).toMatch(
        new RegExp(
          `^request_completed requestId=rid-1 method=GET path=/api/v1/tarefas status=${statusCode} durationMs=\\d+ userId=user-9$`,
        ),
      );
    });

    it('sem usuario autenticado registra userId=anonymous', async () => {
      const trace = await traceMiddleware();
      const spy = jest.spyOn(activeLoggerProto, 'log').mockImplementation(() => undefined);
      const { req, res, next, handlers } = requestLog(200, undefined, { 'x-request-id': 'rid-2' });
      trace(req, res, next);
      handlers.finish();
      expect(String(spy.mock.calls.at(-1)?.[0])).toMatch(/userId=anonymous$/);
    });
  });
});
