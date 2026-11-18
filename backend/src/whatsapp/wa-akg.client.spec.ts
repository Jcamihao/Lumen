import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { WaAkgClient, WaAkgSendError } from './wa-akg.client';

const JID = '5511999990000@s.whatsapp.net';
const API_KEY = 'chave-super-secreta-123';

function buildClient(timeoutMs = 8000) {
  const values: Record<string, unknown> = {
    'whatsapp.waAkgBaseUrl': 'https://wa.exemplo.test',
    'whatsapp.waAkgSessionId': 'lumen',
    'whatsapp.waAkgApiKey': API_KEY,
    'whatsapp.waAkgTimeoutMs': timeoutMs,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new WaAkgClient(config);
}

describe('WaAkgClient', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn(async () => new Response('{"status":true}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('envia POST com URL, cabecalhos e corpo exatos, jid codificado', async () => {
    await buildClient().sendText(JID, 'oi');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://wa.exemplo.test/api/messages/lumen/${encodeURIComponent(JID)}/send`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-API-Key': API_KEY, 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ message: { text: 'oi' } });
    expect(init.signal).toBeDefined();
  });

  it('resposta HTTP de erro vira WaAkgSendError com o status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(buildClient().sendText(JID, 'oi')).rejects.toMatchObject({
      name: 'WaAkgSendError',
      reason: 'http 503',
    });
  });

  it('timeout vira WaAkgSendError com motivo timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    await expect(buildClient().sendText(JID, 'oi')).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('nao loga o texto, a chave nem o jid em nenhum caminho de erro', async () => {
    const logSpies = [
      jest.spyOn(Logger.prototype, 'log'),
      jest.spyOn(Logger.prototype, 'warn'),
      jest.spyOn(Logger.prototype, 'error'),
    ];
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const error = await buildClient().sendText(JID, 'TEXTO-PRIVADO').catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(API_KEY);
    expect(String((error as Error).message)).not.toContain('TEXTO-PRIVADO');
    logSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
