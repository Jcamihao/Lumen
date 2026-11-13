import * as http from 'node:http';
import * as https from 'node:https';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AsaasCheckout {
  id: string;
  link: string;
}

export interface AsaasSubscription {
  id: string;
  deleted: boolean;
  nextDueDate: string; // ISO date (YYYY-MM-DD), vem cru do Asaas
  externalReference: string | null;
}

export interface CreateCheckoutParams {
  value: number;
  cycle: 'MONTHLY' | 'YEARLY';
  externalReference: string;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
  minutesToExpire: number;
}

interface RawAsaasSubscription {
  id: string;
  deleted?: boolean;
  nextDueDate: string;
  externalReference?: string | null;
}

interface RawResponse {
  statusCode: number;
  body: string;
}

const MAX_ATTEMPTS = 3; // 1 tentativa inicial + 2 retentativas
const RETRY_BACKOFF_MS = 250;

export class AsaasClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AsaasClientError';
  }
}

@Injectable()
export class AsaasClient {
  private readonly logger = new Logger(AsaasClient.name);

  constructor(private readonly configService: ConfigService) {}

  async createCheckout(params: CreateCheckoutParams): Promise<AsaasCheckout> {
    const result = await this.request<{ id: string; link: string }>(
      'POST',
      '/checkouts',
      {
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: params.minutesToExpire,
        externalReference: params.externalReference,
        callback: {
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl,
          expiredUrl: params.expiredUrl,
        },
        // Validado no sandbox em 2026-11-13: o Asaas exige `items` (o valor
        // cobrado e exibido vem daqui; `subscription.value` e ignorado) e
        // `subscription.nextDueDate`.
        items: [
          {
            name: 'Plano Individual do Lumen',
            description:
              params.cycle === 'YEARLY'
                ? 'Assinatura anual'
                : 'Assinatura mensal',
            quantity: 1,
            value: params.value,
          },
        ],
        subscription: {
          cycle: params.cycle,
          nextDueDate: this.todayInSaoPaulo(),
        },
      },
    );

    return { id: result.id, link: result.link };
  }

  /** Data de hoje (YYYY-MM-DD) no fuso de São Paulo, o que o Asaas espera. */
  private todayInSaoPaulo(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date());
  }

  async getSubscription(id: string): Promise<AsaasSubscription> {
    const result = await this.request<RawAsaasSubscription>(
      'GET',
      `/subscriptions/${id}`,
    );
    return this.mapSubscription(result);
  }

  async findSubscriptionByExternalReference(
    ref: string,
  ): Promise<AsaasSubscription | null> {
    const query = new URLSearchParams({ externalReference: ref }).toString();
    const result = await this.request<{ data: RawAsaasSubscription[] }>(
      'GET',
      `/subscriptions?${query}`,
    );

    if (!result.data || result.data.length === 0) {
      return null;
    }

    return this.mapSubscription(result.data[0]);
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.request<unknown>('DELETE', `/subscriptions/${id}`);
  }

  private mapSubscription(raw: RawAsaasSubscription): AsaasSubscription {
    return {
      id: raw.id,
      deleted: Boolean(raw.deleted),
      nextDueDate: raw.nextDueDate,
      externalReference: raw.externalReference ?? null,
    };
  }

  /**
   * Orquestra a chamada HTTP com retry/backoff e conversão de erro.
   * Retry (até `MAX_ATTEMPTS - 1` vezes) só em erro de rede/timeout ou 5xx;
   * erro 4xx nunca repete (é erro de dado, repetir não resolve).
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;

      let response: RawResponse | undefined;
      try {
        response = await this.performRequest(method, path, body);
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_ATTEMPTS) {
          throw new AsaasClientError(
            `Falha ao chamar o Asaas (${method} ${path}): ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
            undefined,
            error,
          );
        }
        await this.delay(attempt);
        continue;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return response.body
          ? (JSON.parse(response.body) as T)
          : (undefined as T);
      }

      if (response.statusCode >= 500 && attempt < MAX_ATTEMPTS) {
        lastError = new AsaasClientError(
          `Asaas respondeu ${response.statusCode} para ${method} ${path}`,
          response.statusCode,
        );
        await this.delay(attempt);
        continue;
      }

      // 4xx nunca repete; 5xx que esgotou as tentativas também não.
      throw new AsaasClientError(
        `Asaas respondeu ${response.statusCode} para ${method} ${path}: ${response.body}`,
        response.statusCode,
      );
    }

    // Inalcançável na prática (o loop sempre retorna ou lança antes), mas
    // mantém o TypeScript feliz e cobre um eventual erro perdido.
    throw lastError instanceof AsaasClientError
      ? lastError
      : new AsaasClientError(`Falha ao chamar o Asaas (${method} ${path}).`);
  }

  private delay(attempt: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, RETRY_BACKOFF_MS * attempt);
    });
  }

  private performRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<RawResponse> {
    const url = new URL(`${this.getBaseUrl()}${path}`);
    const requestImpl = url.protocol === 'https:' ? https.request : http.request;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const timeoutMs = this.getTimeoutMs();

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        access_token: this.getApiKey(),
        Accept: 'application/json',
        // O Asaas rejeita (400 user_agent_not_informed) chamada sem User-Agent.
        'User-Agent': 'Lumen',
      };
      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const request = requestImpl(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? parseInt(url.port, 10) : undefined,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on('end', () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(
          new Error(`Timeout ao chamar o Asaas (${timeoutMs}ms).`),
        );
      });

      request.on('error', (error) => {
        this.logger.warn(`Erro ao chamar o Asaas (${method} ${path}): ${error.message}`);
        reject(error);
      });

      if (payload !== undefined) {
        request.write(payload);
      }
      request.end();
    });
  }

  private getApiKey(): string {
    return this.configService.get<string>('asaas.apiKey') ?? '';
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>('asaas.baseUrl') ??
      'https://api-sandbox.asaas.com/v3'
    );
  }

  private getTimeoutMs(): number {
    return this.configService.get<number>('asaas.timeoutMs') ?? 10000;
  }
}
