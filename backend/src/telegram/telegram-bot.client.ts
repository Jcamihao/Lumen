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

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

/** Teclado que acompanha um envio (o Telegram aceita um so por mensagem). */
export type TelegramMarkup =
  | { kind: 'confirm'; labels: string[] }
  | { kind: 'menu' }
  | { kind: 'inline'; rows: TelegramInlineButton[][] };

/** Rotulo do botao fixo de resposta que abre o menu (texto "Menu" devolvido ao bot). */
export const MENU_BUTTON_LABEL = 'Menu';

/** Mensagem de chat privado ja conferida (contrato 10, D2/D4). Texto vazio = midia sem caption. */
export interface TelegramMessageInbound {
  kind: 'message';
  updateId: number;
  chatId: string;
  messageId: string;
  text: string;
  hasText: boolean;
}

/** Clique de botao inline: a mensagem de origem e o id do callback vem do proprio update. */
export interface TelegramCallbackInbound {
  kind: 'callback';
  updateId: number;
  chatId: string;
  callbackId: string;
  messageId: number;
  data: string;
}

export type TelegramInbound = TelegramMessageInbound | TelegramCallbackInbound;

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
   * fica acima, senao toda espera viraria erro. allowed_updates: mensagem e clique de botao (callback_query).
   */
  async getUpdates(offset: number, timeoutS: number): Promise<unknown[]> {
    const params = new URLSearchParams({
      offset: String(offset),
      timeout: String(timeoutS),
      allowed_updates: '["message","callback_query"]',
    });
    const timeoutMs = timeoutS * 1000 + 10_000;
    const result = await this.call('getUpdates', params, { method: 'GET', timeoutMs });
    return Array.isArray(result) ? (result as unknown[]) : [];
  }

  /** Teclado de resposta (D4): botoes de texto que o Telegram devolve como mensagem. So no ultimo envio. */
  async sendMessage(chatId: string, text: string, markup?: TelegramMarkup): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (markup) body.reply_markup = replyMarkupBody(markup);
    await this.call('sendMessage', body);
  }

  /** Troca o texto e o teclado inline de uma mensagem ja enviada (navegacao do menu no lugar). */
  async editMessageText(chatId: string, messageId: number, text: string, rows: TelegramInlineButton[][]): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows },
    });
  }

  /** Confirma o clique para o Telegram parar de mostrar o aviso de carregando no botao. */
  async answerCallbackQuery(callbackId: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId });
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
 * grupos/canais, edicoes, callback sem mensagem ou de chat nao privado e qualquer forma inesperada.
 * Nenhum campo do evento define dono.
 */
export function parseTelegramUpdate(update: unknown): TelegramInbound | null {
  const value = asRecord(update);
  if (!value) return null;
  if (typeof value.update_id !== 'number' || !Number.isSafeInteger(value.update_id) || value.update_id <= 0) return null;
  if (value.callback_query !== undefined) return parseCallback(value.update_id, value.callback_query);
  return parseMessage(value.update_id, value.message);
}

function parseMessage(updateId: number, raw: unknown): TelegramMessageInbound | null {
  const message = asRecord(raw);
  if (!message) return null;
  const chatId = privateChatId(message);
  if (!chatId || !isSafeId(message.message_id)) return null;
  const text = typeof message.text === 'string' ? message.text : '';
  return { kind: 'message', updateId, chatId, messageId: `tg-${updateId}`, text, hasText: text.length > 0 };
}

function parseCallback(updateId: number, raw: unknown): TelegramCallbackInbound | null {
  const callback = asRecord(raw);
  if (!callback || typeof callback.id !== 'string' || callback.id === '') return null;
  const message = asRecord(callback.message);
  if (!message) return null;
  const chatId = privateChatId(message);
  if (!chatId || !isSafeId(message.message_id)) return null;
  if (typeof callback.data !== 'string') return null;
  return { kind: 'callback', updateId, chatId, callbackId: callback.id, messageId: message.message_id, data: callback.data };
}

function privateChatId(message: Record<string, unknown>): string | null {
  const chat = asRecord(message.chat);
  if (!chat || chat.type !== 'private' || !isSafeId(chat.id)) return null;
  return String(chat.id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function isSafeId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function replyMarkupBody(markup: TelegramMarkup): Record<string, unknown> {
  switch (markup.kind) {
    case 'confirm':
      return {
        keyboard: markup.labels.map((label) => [{ text: label }]),
        resize_keyboard: true,
        one_time_keyboard: true,
      };
    case 'menu':
      return { keyboard: [[{ text: MENU_BUTTON_LABEL }]], resize_keyboard: true, is_persistent: true };
    case 'inline':
      return { inline_keyboard: markup.rows };
  }
}
