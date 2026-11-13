import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { AsaasClient, AsaasClientError } from './asaas-client';

describe('AsaasClient', () => {
  const buildConfigService = (overrides: Record<string, unknown> = {}) =>
    ({
      get: jest.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          'asaas.apiKey': 'asaas-key-123',
          'asaas.baseUrl': 'https://api-sandbox.asaas.com/v3',
          'asaas.webhookToken': 'webhook-token-abc',
          'asaas.timeoutMs': 10000,
        };

        return overrides[key] ?? defaults[key];
      }),
    }) as any;

  const buildClient = (overrides?: Record<string, unknown>) =>
    new AsaasClient(buildConfigService(overrides));

  describe('métodos públicos (espionando o request privado)', () => {
    it('createCheckout usa a data de hoje em São Paulo como nextDueDate (21h de SP ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-14T01:30:00Z'));
      try {
        const client = buildClient();
        const requestSpy = jest
          .spyOn(client as any, 'request')
          .mockResolvedValue({ id: 'c', link: 'https://x' });

        await client.createCheckout({
          value: 149,
          cycle: 'YEARLY',
          externalReference: 'ref',
          successUrl: 'https://a',
          cancelUrl: 'https://b',
          expiredUrl: 'https://c',
          minutesToExpire: 60,
        });

        const body = requestSpy.mock.calls[0][2] as any;
        expect(body.subscription).toEqual({
          cycle: 'YEARLY',
          nextDueDate: '2026-11-13',
        });
        expect(body.items[0]).toMatchObject({
          description: 'Assinatura anual',
          value: 149,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('createCheckout monta POST /checkouts com o corpo fixo e devolve {id, link}', async () => {
      const client = buildClient();
      const requestSpy = jest.spyOn(client as any, 'request').mockResolvedValue({
        id: 'checkout-1',
        link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1',
      });

      const result = await client.createCheckout({
        value: 14.9,
        cycle: 'MONTHLY',
        externalReference: 'sub-local-1',
        successUrl: 'https://app.exemplo.com/plano?checkout=sucesso',
        cancelUrl: 'https://app.exemplo.com/plano?checkout=cancelado',
        expiredUrl: 'https://app.exemplo.com/plano?checkout=expirado',
        minutesToExpire: 60,
      });

      expect(requestSpy).toHaveBeenCalledWith(
        'POST',
        '/checkouts',
        expect.objectContaining({
          billingTypes: ['CREDIT_CARD'],
          externalReference: 'sub-local-1',
          minutesToExpire: 60,
          callback: {
            successUrl: 'https://app.exemplo.com/plano?checkout=sucesso',
            cancelUrl: 'https://app.exemplo.com/plano?checkout=cancelado',
            expiredUrl: 'https://app.exemplo.com/plano?checkout=expirado',
          },
          // O Asaas exige `items` (o valor cobrado vem daqui; subscription.value
          // é ignorado) e `subscription.nextDueDate` (YYYY-MM-DD, fuso de SP).
          items: [
            {
              name: 'Plano Individual do Lumen',
              description: 'Assinatura mensal',
              quantity: 1,
              value: 14.9,
            },
          ],
          subscription: {
            cycle: 'MONTHLY',
            nextDueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          },
        }),
      );
      expect(
        (requestSpy.mock.calls[0][2] as any).subscription,
      ).not.toHaveProperty('value');
      // Nunca manda customerData (confirmado no spike: parcial dá 400).
      expect(requestSpy.mock.calls[0][2]).not.toHaveProperty('customerData');
      expect(result).toEqual({
        id: 'checkout-1',
        link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1',
      });
    });

    it('getSubscription faz GET /subscriptions/{id} e devolve id/deleted/nextDueDate/externalReference', async () => {
      const client = buildClient();
      const requestSpy = jest.spyOn(client as any, 'request').mockResolvedValue({
        id: 'sub-1',
        deleted: false,
        nextDueDate: '2026-10-27',
        externalReference: 'local-1',
        status: 'ACTIVE', // campo que o spike não confirmou; não deve vazar pro resultado mapeado
      });

      const result = await client.getSubscription('sub-1');

      expect(requestSpy).toHaveBeenCalledWith('GET', '/subscriptions/sub-1');
      expect(result).toEqual({
        id: 'sub-1',
        deleted: false,
        nextDueDate: '2026-10-27',
        externalReference: 'local-1',
      });
    });

    it('findSubscriptionByExternalReference faz GET /subscriptions?externalReference={ref} e devolve data[0] mapeado', async () => {
      const client = buildClient();
      const requestSpy = jest.spyOn(client as any, 'request').mockResolvedValue({
        data: [
          {
            id: 'sub-2',
            deleted: false,
            nextDueDate: '2026-11-27',
            externalReference: 'local-2',
          },
        ],
      });

      const result = await client.findSubscriptionByExternalReference('local-2');

      expect(requestSpy).toHaveBeenCalledWith(
        'GET',
        '/subscriptions?externalReference=local-2',
      );
      expect(result).toEqual({
        id: 'sub-2',
        deleted: false,
        nextDueDate: '2026-11-27',
        externalReference: 'local-2',
      });
    });

    it('findSubscriptionByExternalReference devolve null quando data vem vazio', async () => {
      const client = buildClient();
      jest.spyOn(client as any, 'request').mockResolvedValue({ data: [] });

      const result = await client.findSubscriptionByExternalReference('local-3');

      expect(result).toBeNull();
    });

    it('deleteSubscription faz DELETE /subscriptions/{id}', async () => {
      const client = buildClient();
      const requestSpy = jest
        .spyOn(client as any, 'request')
        .mockResolvedValue({ deleted: true, id: 'sub-3' });

      await client.deleteSubscription('sub-3');

      expect(requestSpy).toHaveBeenCalledWith('DELETE', '/subscriptions/sub-3');
    });
  });

  describe('request() — retry, backoff e erros (espionando o performRequest privado, no padrão do postJson do MailService)', () => {
    const buildClientWithoutRealDelay = () => {
      const client = buildClient();
      jest.spyOn(client as any, 'delay').mockResolvedValue(undefined);
      return client;
    };

    it('tenta de novo em 5xx e devolve sucesso se uma tentativa seguinte passar', async () => {
      const client = buildClientWithoutRealDelay();
      const performSpy = jest
        .spyOn(client as any, 'performRequest')
        .mockResolvedValueOnce({ statusCode: 502, body: '' })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ ok: true }) });

      const result = await (client as any).request('GET', '/subscriptions/sub-x');

      expect(performSpy).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it('desiste depois de esgotar as tentativas em 5xx repetido e lança AsaasClientError', async () => {
      const client = buildClientWithoutRealDelay();
      const performSpy = jest
        .spyOn(client as any, 'performRequest')
        .mockResolvedValue({ statusCode: 503, body: 'indisponivel' });

      await expect(
        (client as any).request('GET', '/subscriptions/sub-x'),
      ).rejects.toBeInstanceOf(AsaasClientError);
      // 1 tentativa inicial + 2 retentativas = 3, nunca mais que isso.
      expect(performSpy).toHaveBeenCalledTimes(3);
    });

    it('não tenta de novo em erro 4xx', async () => {
      const client = buildClientWithoutRealDelay();
      const performSpy = jest
        .spyOn(client as any, 'performRequest')
        .mockResolvedValue({
          statusCode: 400,
          body: '{"errors":[{"description":"dado invalido"}]}',
        });

      await expect(
        (client as any).request('POST', '/checkouts', {}),
      ).rejects.toBeInstanceOf(AsaasClientError);
      expect(performSpy).toHaveBeenCalledTimes(1);
    });

    it('erro de rede/timeout também é tentado de novo (até esgotar as tentativas) e vira AsaasClientError', async () => {
      const client = buildClientWithoutRealDelay();
      const performSpy = jest
        .spyOn(client as any, 'performRequest')
        .mockRejectedValue(new Error('Timeout ao chamar o Asaas (10000ms).'));

      await expect(
        (client as any).request('GET', '/subscriptions/sub-x'),
      ).rejects.toBeInstanceOf(AsaasClientError);
      expect(performSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('performRequest() — chamada HTTP crua contra um servidor local de verdade', () => {
    let server: http.Server;
    let baseUrl: string;
    let lastRequest: { method?: string; headers: http.IncomingHttpHeaders; body: string };

    beforeEach((done) => {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          lastRequest = {
            method: req.method,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'sub-real', deleted: false, nextDueDate: '2026-10-27' }));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        done();
      });
    });

    afterEach((done) => {
      server.close(() => done());
    });

    it('manda access_token com a apiKey e NÃO manda Authorization: Bearer', async () => {
      const client = buildClient({
        'asaas.apiKey': 'minha-chave-sandbox',
        'asaas.baseUrl': baseUrl,
      });

      await client.getSubscription('sub-real');

      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.headers['access_token']).toBe('minha-chave-sandbox');
      expect(lastRequest.headers.authorization).toBeUndefined();
    });

    it('manda User-Agent (o Asaas responde 400 user_agent_not_informed sem ele)', async () => {
      const client = buildClient({
        'asaas.apiKey': 'minha-chave-sandbox',
        'asaas.baseUrl': baseUrl,
      });

      await client.getSubscription('sub-real');

      expect(lastRequest.headers['user-agent']).toBe('Lumen');
    });
  });
});
