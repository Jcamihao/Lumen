import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Falha de envio. Nao carrega o texto nem a chave: so o status HTTP ou 'timeout'/'network'. */
export class WaAkgSendError extends Error {
  constructor(readonly reason: string) {
    super(`WA-AKG envio falhou: ${reason}`);
    this.name = 'WaAkgSendError';
  }
}

@Injectable()
export class WaAkgClient {
  constructor(private readonly config: ConfigService) {}

  /** Envia texto a um JID pelo WA-AKG. Nunca loga corpo nem chave. */
  async sendText(jid: string, text: string): Promise<void> {
    const baseUrl = this.config.get<string>('whatsapp.waAkgBaseUrl') ?? '';
    const sessionId = this.config.get<string>('whatsapp.waAkgSessionId') ?? '';
    const apiKey = this.config.get<string>('whatsapp.waAkgApiKey') ?? '';
    const timeoutMs = this.config.get<number>('whatsapp.waAkgTimeoutMs') ?? 8000;
    const url = `${baseUrl}/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/send`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { text } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const isTimeout = (error as { name?: string } | null)?.name === 'TimeoutError' || (error as { name?: string } | null)?.name === 'AbortError';
      throw new WaAkgSendError(isTimeout ? 'timeout' : 'network');
    }
    if (!response.ok) {
      throw new WaAkgSendError(`http ${response.status}`);
    }
  }
}
