import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CacheQueueService } from '../cache-queue/cache-queue.service';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationReply } from '../conversation/conversation.types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBotClient, TelegramCallbackInbound, TelegramInbound, TelegramMarkup, TelegramMessageInbound, parseTelegramUpdate } from './telegram-bot.client';
import { FIXED_MENU_MARKUP, formatReplyForTelegram, nodeIdFromCallback } from './telegram-format';
import { TelegramLinkService } from './telegram-link.service';
import { looksLikeLinkCode } from '../whatsapp/whatsapp-link.service';
import { maskChatId } from './telegram-mask';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_HITS = 20;
const LINK_FAIL_WINDOW_MS = 10 * 60_000;
const LINK_FAIL_MAX = 5;
const HINT_WINDOW_MS = 60 * 60_000;
const MAX_TEXT_CHARS = 1000;
const UNLINK_COMMAND = 'desvincular telegram';
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const OFFSET_ROW_ID = 'poll';

export const TELEGRAM_TEXTS = {
  linked: 'Pronto! Este chat está vinculado ao seu Lumen. Mande, por exemplo, "50 mercado" ou "saldo".',
  linkFailed: 'Não consegui validar este código. Gere um novo no Lumen, em Configurações > Conta > Telegram, e envie de novo.',
  hint: 'Este chat ainda não está vinculado a uma conta do Lumen. Abra o Lumen, vá em Configurações > Conta > Telegram e gere um código de vínculo.',
  media: 'Notas e arquivos são enviados pela tela de Importações do app do Lumen. Por aqui eu leio só texto.',
  unlinked: 'Chat desvinculado. Para usar o Lumen por aqui de novo, gere um novo código de vínculo no app.',
  empty: 'Não entendi a mensagem. Mande um texto curto, por exemplo "50 mercado" ou "saldo".',
  tooLong: 'Mensagem muito longa. Mande um texto de até 1000 caracteres.',
};

const BOT_COMMANDS = [
  { command: 'saldo', description: 'Balanço do mês' },
  { command: 'gastos', description: 'Gastos por categoria' },
  { command: 'cartao', description: 'Limite e uso do cartão' },
  { command: 'cartoes', description: 'Meus cartões' },
  { command: 'ajuda', description: 'O que eu sei fazer' },
  { command: 'menu', description: 'Abrir o menu de botões' },
  { command: 'start', description: 'Abrir o menu' },
];

/** Comando do menu que vira a frase equivalente do motor. */
const COMMAND_PHRASES: Record<string, string> = {
  '/menu': 'menu',
  '/start': 'menu',
  '/saldo': 'saldo',
  '/gastos': 'gastos',
  '/ajuda': 'ajuda',
  '/cartao': 'cartao',
  '/cartoes': 'meus cartoes',
};

export function toEngineText(text: string): string {
  return COMMAND_PHRASES[normalizeCommand(text)] ?? text;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Minusculas e espacos colapsados, para comparar com frases de comando. */
function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Long polling da Bot API (D2 do contrato 10): um laço consome getUpdates, processa na ordem e
 * persiste o offset por update lido (mesmo os descartados), para nenhum update se perder no restart.
 * O laço so roda com TELEGRAM_ENABLED=true e para no destroy; erro de rede faz backoff sem derrubar nada.
 * Exatamente uma instancia do backend deve consumir (o contrato registra esse custo).
 */
@Injectable()
export class TelegramAdapterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramAdapterService.name);
  private stopRequested = false;
  private backoffMs = BACKOFF_BASE_MS;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheQueueService,
    private readonly links: TelegramLinkService,
    private readonly conversation: ConversationService,
    private readonly client: TelegramBotClient,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('telegram.enabled') !== true) return;
    const missing = [['TELEGRAM_BOT_TOKEN', 'telegram.botToken'] as const].filter(([, key]) => !this.config.get<string>(key)).map(([env]) => env);
    if (missing.length > 0) {
      throw new Error(`TELEGRAM_ENABLED=true mas faltam variáveis: ${missing.join(', ')}`);
    }
    this.loopPromise = this.loop();
  }

  onModuleDestroy(): void {
    this.stopRequested = true;
  }

  /** Aguarda o laço parar (depois de stopRequested). Sem laço (canal off), resolve na hora. */
  async stopped(): Promise<void> {
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    let offset = await this.loadOffset();
    await this.sendCommandsBestEffort();

    while (!this.stopRequested) {
      let updates: unknown[] = [];
      try {
        updates = await this.client.getUpdates(offset + 1, this.config.get<number>('telegram.pollTimeoutS') ?? 25);
        this.backoffMs = BACKOFF_BASE_MS;
      } catch (error) {
        this.logger.warn(`telegram polling falhou: ${(error as Error).name}`);
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
        continue;
      }

      let touched = false;
      for (const update of updates) {
        await this.processSafely(update);
        const updateId = (update as { update_id?: unknown })?.update_id;
        if (typeof updateId === 'number' && updateId > offset) {
          offset = updateId;
          touched = true;
        }
      }
      if (touched) {
        try {
          await this.saveOffset(offset);
        } catch (error) {
          // Offest velho so custa re-leitura (o motor deduplica por messageId): loga e segue.
          this.logger.warn(`telegram offset nao salvo: ${(error as Error).name}`);
        }
      }
    }
  }

  private async processSafely(update: unknown): Promise<void> {
    const inbound = parseTelegramUpdate(update);
    if (!inbound) return;
    try {
      await this.process(inbound);
    } catch (error) {
      this.logger.warn(`telegram inbound falhou: ${(error as Error).name}`);
    }
  }

  /** Roteamento de uma entrada ja parseada. O dono vem so do vinculo (chatId -> userId), nunca do evento. */
  async process(inbound: TelegramInbound): Promise<void> {
    const chatHash = sha256(inbound.chatId);
    const rate = await this.cache.hitRateLimitWindow(`telegram:rate:${chatHash}`, RATE_WINDOW_MS);
    if (rate && rate.hits > RATE_MAX_HITS) return;

    const userId = await this.links.findUserIdByChatId(inbound.chatId);
    if (inbound.kind === 'callback') {
      await this.handleCallback(inbound, userId, rate !== null);
      return;
    }
    if (!userId) {
      // Sem Redis, chat sem vinculo fica mudo (falha fechada), igual ao WhatsApp.
      if (!rate || !inbound.hasText) return;
      await this.handleUnlinked(inbound, chatHash);
      return;
    }

    await this.handleLinked(inbound, userId);
  }

  private async handleUnlinked(inbound: TelegramMessageInbound, chatHash: string): Promise<void> {
    if (looksLikeLinkCode(inbound.text)) {
      // A tentativa e contada antes do resgate (INCR atomico): tentativas em paralelo nao furam o limite.
      const attempts = await this.cache.hitRateLimitWindow(`telegram:linkfail:${chatHash}`, LINK_FAIL_WINDOW_MS);
      if (!attempts || attempts.hits > LINK_FAIL_MAX) return;

      const linked = await this.links.redeem(inbound.chatId, inbound.text);
      await this.send(inbound.chatId, [linked ? TELEGRAM_TEXTS.linked : TELEGRAM_TEXTS.linkFailed], linked ? FIXED_MENU_MARKUP : undefined);
      return;
    }

    // Orientacao: no maximo uma por hora por chat. Hits > 1 = ja enviada nesta janela.
    const hint = await this.cache.hitRateLimitWindow(`telegram:hint:${chatHash}`, HINT_WINDOW_MS);
    if (hint && hint.hits === 1) {
      await this.send(inbound.chatId, [TELEGRAM_TEXTS.hint]);
    }
  }

  /**
   * Clique de botao. Sem vinculo, so limpa o aviso do botao (e fica mudo se o Redis caiu, como a mensagem).
   * O no vem do callback_data (conferido por nodeIdFromCallback); o dono vem so do vinculo.
   */
  private async handleCallback(inbound: TelegramCallbackInbound, userId: string | null, redisUp: boolean): Promise<void> {
    if (!userId) {
      if (redisUp) await this.answerBestEffort(inbound.callbackId);
      return;
    }
    const nodeId = nodeIdFromCallback(inbound.data);
    if (!nodeId) return;

    await this.answerBestEffort(inbound.callbackId);
    const reply = await this.conversation.handleMenuAction({
      userId,
      channel: 'TELEGRAM',
      messageId: inbound.callbackId,
      nodeId,
      receivedAt: new Date(),
    });
    if (reply.kind === 'DUPLICATE') return;

    const formatted = formatReplyForTelegram(reply);
    if (reply.kind === 'MENU') {
      await this.showMenuInPlace(inbound, formatted.parts, formatted.markup);
      return;
    }
    await this.send(inbound.chatId, formatted.parts, formatted.markup);
  }

  /** Menu no lugar: edita a mensagem do clique. Se a edicao falhar (velha, apagada, igual), manda mensagem nova. */
  private async showMenuInPlace(inbound: TelegramCallbackInbound, parts: string[], markup: TelegramMarkup): Promise<void> {
    const rows = markup.kind === 'inline' ? markup.rows : [];
    try {
      await this.client.editMessageText(inbound.chatId, inbound.messageId, parts[0], rows);
    } catch (error) {
      this.logger.warn(`telegram edicao do menu falhou: ${(error as Error).name}`);
      await this.send(inbound.chatId, parts, markup);
    }
  }

  private async answerBestEffort(callbackId: string): Promise<void> {
    try {
      await this.client.answerCallbackQuery(callbackId);
    } catch (error) {
      this.logger.warn(`telegram resposta do botao falhou: ${(error as Error).name}`);
    }
  }

  private async handleLinked(inbound: TelegramMessageInbound, userId: string): Promise<void> {
    if (!inbound.hasText) {
      await this.send(inbound.chatId, [TELEGRAM_TEXTS.media], FIXED_MENU_MARKUP);
      return;
    }

    const text = inbound.text.trim();
    if (normalizeCommand(text) === UNLINK_COMMAND) {
      await this.links.unlinkByUserId(userId);
      await this.send(inbound.chatId, [TELEGRAM_TEXTS.unlinked]);
      return;
    }
    if (text.length === 0) {
      await this.send(inbound.chatId, [TELEGRAM_TEXTS.empty], FIXED_MENU_MARKUP);
      return;
    }
    if (text.length > MAX_TEXT_CHARS) {
      await this.send(inbound.chatId, [TELEGRAM_TEXTS.tooLong], FIXED_MENU_MARKUP);
      return;
    }

    const reply: ConversationReply = await this.conversation.handleMessage({
      userId,
      channel: 'TELEGRAM',
      messageId: inbound.messageId,
      text: toEngineText(inbound.text),
      receivedAt: new Date(),
    });
    // Duplicata: o motor ja respondeu a primeira vez; reenviar repetiria a mesma resposta.
    if (reply.kind === 'DUPLICATE') return;

    const formatted = formatReplyForTelegram(reply);
    await this.send(inbound.chatId, formatted.parts, formatted.markup);
  }

  /** Envia partes em ordem; o teclado (D4) so acompanha a ultima. Falha para no meio: loga e nao lanca. */
  async send(chatId: string, parts: string[], markup?: TelegramMarkup): Promise<void> {
    for (let index = 0; index < parts.length; index += 1) {
      try {
        await this.client.sendMessage(chatId, parts[index], index === parts.length - 1 ? markup : undefined);
      } catch (error) {
        this.logger.warn(`telegram envio falhou para ${maskChatId(chatId)}: ${(error as Error).message}`);
        return;
      }
    }
  }

  private async sendCommandsBestEffort(): Promise<void> {
    try {
      await this.client.setMyCommands(BOT_COMMANDS);
    } catch (error) {
      this.logger.warn(`telegram menu de comandos nao aplicado: ${(error as Error).name}`);
    }
  }

  private async loadOffset(): Promise<number> {
    try {
      const row = await this.prisma.telegramBotState.findUnique({ where: { id: OFFSET_ROW_ID } });
      return row ? Number(row.lastUpdateId) : 0;
    } catch (error) {
      this.logger.warn(`telegram offset nao lido (${(error as Error).name}); comecando do 0`);
      return 0;
    }
  }

  private async saveOffset(offset: number): Promise<void> {
    await this.prisma.telegramBotState.upsert({
      where: { id: OFFSET_ROW_ID },
      create: { id: OFFSET_ROW_ID, lastUpdateId: BigInt(offset) },
      update: { lastUpdateId: BigInt(offset) },
    });
  }

  /** Espera que nao segura o processo (unref) e que o stop pode vencer no proximo tick. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}
