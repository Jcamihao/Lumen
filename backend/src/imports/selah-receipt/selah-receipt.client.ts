import { BadRequestException } from '@nestjs/common';
import { sniffMime } from '../../common/utils/file-sniff';
import { postJson } from './post-json';
import { readBooleanEnv, readEnv, readReceiptTimeout } from './selah-env';

// Selah desligado no fluxo de nota (contrato item 4, secao 7): cliente mantido, sem uso.
// Nenhum servico de importacao depende dele; nao ha troca silenciosa entre extrator local e Selah.

export type ReceiptParseResponse = Record<string, unknown>;

function readRetryAfterSeconds(body: string): number | null {
  try {
    const seconds = Number(JSON.parse(body)?.retryAfterSeconds);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
  } catch {
    return null;
  }
}

function rateLimitedError(body: string): BadRequestException {
  // O Selah limita por app (429 + Retry-After); o corpo traz o mesmo prazo.
  const seconds = readRetryAfterSeconds(body);
  return new BadRequestException(
    seconds
      ? `O SelahIA esta com muitas leituras em andamento. Tente de novo em ${seconds}s.`
      : 'O SelahIA esta com muitas leituras em andamento. Tente de novo em instantes.',
  );
}

function buildUrl(baseUrl: string): string {
  const route = readEnv('SELAH_RECEIPT_ROUTE') || '/v1/adapters/lumen/receipt-parser/parse';
  return `${baseUrl.replace(/\/+$/, '')}${route.startsWith('/') ? route : `/${route}`}`;
}

export class SelahReceiptClient {
  async parse(file: Express.Multer.File, knownCategories: string[]): Promise<ReceiptParseResponse> {
    const baseUrl = readEnv('SELAH_BASE_URL');
    if (!readBooleanEnv('SELAH_ASSISTANT_ENABLED') || !baseUrl) {
      throw new BadRequestException('A leitura de nota fiscal por IA nao esta habilitada neste ambiente.');
    }
    const response = await this.send(buildUrl(baseUrl), file, knownCategories);
    if (response.statusCode === 429) throw rateLimitedError(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new BadRequestException(`Falha ao analisar a nota com SelahIA: ${response.body.slice(0, 240)}`);
    }
    return this.readBody(response.body);
  }

  private async send(url: string, file: Express.Multer.File, knownCategories: string[]) {
    const body = JSON.stringify({
      fileName: file.originalname,
      mimeType: sniffMime(file.buffer) ?? file.mimetype,
      imageBase64: file.buffer.toString('base64'),
      preferredCurrency: 'BRL',
      localeHint: 'pt-BR',
      knownCategories,
    });
    const apiKey = readEnv('SELAH_API_KEY');
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'X-Source-App': readEnv('SELAH_SOURCE_APP') || 'LumenBack',
      ...(apiKey ? { 'X-Selah-Api-Key': apiKey } : {}),
    };
    try {
      return await postJson(url, body, headers, readReceiptTimeout());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Falha ao consultar o SelahIA: ${message}`);
    }
  }

  private readBody(body: string): ReceiptParseResponse {
    try {
      return JSON.parse(body) as ReceiptParseResponse;
    } catch {
      throw new BadRequestException('SelahIA retornou uma resposta invalida para leitura da nota fiscal.');
    }
  }
}
