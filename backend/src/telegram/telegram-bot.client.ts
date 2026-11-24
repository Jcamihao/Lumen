import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Falha da Bot API. Nao carrega a URL (tem o token), o texto enviado nem a resposta do Telegram:
 * so 'timeout', 'network' ou o status HTTP.
 */
export class TelegramBotError extends Error {
  constructor(readonly reason: string) {
    super(`Telegram: chamada falhou (${reason})`);
    this.name = 'TelegramBotError';
  }
}

export interface TelegramKeyboardButton {
  text: string;
}

/** Update do getUpdates ja conferido (contrato 10, D2/D4): so mensagem de chat privado vira entrada. */
export interface TelegramInbound {
  updateId: number;
  chatId: string;
  messageId: string;
  /** Texto da mensagem. Vazio quando a entrada e midia (foto, documento) sem caption. */
  text: string;
  hasText: boolean;
}

/**
 * Cliente cru da Bot API via fetch (D8 do contrato 10; sem lib nova), no padrao do WaAkgClient:
 * nunca loga corpo nem URL (a URL contem o token) e nao segue redirecionamento.
 */
@Injectable()
export class TelegramBotClient {
  private botUsername: string | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Username do bot (getMe, memoizado). Null ate a primeira chamada bem-sucedida; falha nao memoiza. */
  async getBotUsername(): Promise<string | null> {
    if (this.botUsername) return this.botUsername;
    try {
      const result = await this.call('getMe', {}) as { username?: unknown } | null;
      if (result && typeof result.username === 'string') this.botUsername = result.username;
    } catch {
      return null;
    }
    return this.botUsername;
  }

  /**
   * Long polling (D2). O timeout e do proprio Telegram (o pedido fica aberto); o timeout da request
   * fica acima, senao toda espera viraria erro. allowed_updates so mensagem: sem callback edicao.
   */
  async getUpdates(offset: number, timeoutS: number): Promise<unknown[]> {
    const params = new URLSearchParams({
      offset: String(offset),
      timeout: String(timeoutS),
      allowed_updates: '["message"]',
    });
    const timeoutMs = timeoutS * 1000 + 10_000;
    const result = await this.call('getUpdates', params, { method: 'GET', timeoutMs });
    return Array.isArray(result) ? (result as unknown[]) : [];
  }

  /** Teclado de resposta (D4): botoes de texto que o Telegram devolve como mensagem. So no ultimo envio. */
  async sendMessage(chatId: string, text: string, keyboard?: string[]): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (keyboard && keyboard.length > 0) {
      body.reply_markup = {
        keyboard: keyboard.map((label) => [{ text: label } as TelegramKeyboardButton]),
        resize_keyboard: true,
        one_time_keyboard: true,
      };
    }
    await this.call('sendMessage', body);
  }

  /** Menu de comandos do bot (best-effort no adapter: falha so loga). */
  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.call('setMyCommands', { commands });
  }

  private async call(method: string, params: URLSearchParams | Record<string, unknown>, opts: { method?: 'GET' | 'POST'; timeoutMs?: number } = {}): Promise<unknown> {
    const base = this.config.get<string>('telegram.baseUrl') ?? 'https://api.telegram.org';
    const token = this.config.get<string>('telegram.botToken') ?? '';
    const timeoutMs = opts.timeoutMs ?? this.config.get<number>('telegram.timeoutMs') ?? 8000;
    const query = params instanceof URLSearchParams ? `?${params.toString()}` : '';
    const url = `${base}/bot${token}/${method}${query}`;
    const isGet = opts.method === 'GET';

    let response: Response;
    try {
      response = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: isGet ? {} : { 'Content-Type': 'application/json' },
        body: isGet ? undefined : JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
        // O token ficaria no header/URL reenviados a outro host se a base mandasse redirecionar.
        redirect: 'manual',
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      throw new TelegramBotError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
    }

    let payload: { ok?: unknown; result?: unknown } | null = null;
    try {
      payload = (await response.json()) as { ok?: unknown; result?: unknown } | null;
    } catch {
      payload = null;
    }
    // Sem isso um 200 com ok:false viraria "sucesso" com resultado vazio.
    if (!response.ok || !payload || payload.ok !== true) {
      throw new TelegramBotError(`http ${response.status}`);
    }
    return payload.result ?? null;
  }
}

/**
 * Confere um update do getUpdates e extrai a entrada. Descarte silencioso (null) para o resto:
 * grupos/canais, edicoes, callback e qualquer forma inesperada. Nenhum campo do evento define dono.
 */
export function parseTelegramUpdate(update: unknown): TelegramInbound | null {
  if (!update || typeof update !== 'object') return null;
  const value = update as Record<string, unknown>;
  if (typeof value.update_id !== 'number' || !Number.isSafeInteger(value.update_id) || value.update_id <= 0) return null;
  const message = value.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') return null;
  const chat = message.chat as Record<string, unknown> | undefined;
  if (!chat || typeof chat !== 'object' || chat.type !== 'private') return null;
  if (typeof chat.id !== 'number' || !Number.isSafeInteger(chat.id) || chat.id <= 0) return null;
  if (typeof message.message_id !== 'number' || !Number.isSafeInteger(message.message_id)) return null;
  const text = typeof message.text === 'string' ? message.text : '';
  return {
    updateId: value.update_id,
    chatId: String(chat.id),
    messageId: `tg-${value.update_id}`,
    text,
    hasText: text.length > 0,
  };
}
