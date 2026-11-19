import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CacheQueueService } from '../cache-queue/cache-queue.service';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationReply } from '../conversation/conversation.types';
import { WaAkgClient } from './wa-akg.client';
import { formatReplyForWhatsapp } from './whatsapp-format';
import { WhatsappLinkService, looksLikeLinkCode } from './whatsapp-link.service';
import { maskJid } from './whatsapp-mask';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_HITS = 20;
const LINK_FAIL_WINDOW_MS = 10 * 60_000;
const LINK_FAIL_MAX = 5;
const HINT_WINDOW_MS = 60 * 60_000;
const MAX_TEXT_CHARS = 1000;
const UNLINK_COMMAND = 'desvincular whatsapp';

export const WHATSAPP_TEXTS = {
  linked: 'Pronto! Este número está vinculado ao seu Lumen. Mande, por exemplo, "50 mercado" ou "saldo".',
  linkFailed: 'Não consegui validar este código. Gere um novo no Lumen, em Configurações > Conta > WhatsApp, e envie de novo.',
  hint: 'Este número ainda não está vinculado a uma conta do Lumen. Abra o Lumen, vá em Configurações > Conta > WhatsApp e gere um código de vínculo.',
  media: 'Notas e arquivos são enviados pela tela de Importações do app do Lumen. Por aqui eu leio só texto.',
  unlinked: 'Número desvinculado. Para usar o Lumen por aqui de novo, gere um novo código de vínculo no app.',
  empty: 'Não entendi a mensagem. Mande um texto curto, por exemplo "50 mercado" ou "saldo".',
  tooLong: 'Mensagem muito longa. Mande um texto de até 1000 caracteres.',
};

/** Evento do WA-AKG ja com forma conferida. Campos vindos de terceiros: nenhum define o dono. */
interface InboundMessage {
  jid: string;
  messageId: string;
  type: unknown;
  content: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Descarte silencioso: devolve null quando o evento nao deve ser processado. */
export function parseInbound(event: unknown, expectedSessionId: string): InboundMessage | null {
  if (!event || typeof event !== 'object') return null;
  const body = event as Record<string, unknown>;
  if (body.event !== 'message.received') return null;
  if (typeof body.sessionId !== 'string' || body.sessionId !== expectedSessionId) return null;
  const data = body.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return null;
  const key = (data.key ?? {}) as Record<string, unknown>;
  if (key.fromMe) return null;
  if (data.isGroup) return null;
  if (typeof data.from !== 'string' || !data.from.endsWith('@s.whatsapp.net')) return null;
  if (typeof key.id !== 'string' || key.id.length === 0) return null;
  return {
    jid: data.from,
    messageId: key.id,
    type: data.type,
    content: typeof data.content === 'string' ? data.content : '',
  };
}

/** Minusculas e espacos colapsados, para comparar com frases de comando. */
function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

@Injectable()
export class WhatsappAdapterService {
  private readonly logger = new Logger(WhatsappAdapterService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheQueueService,
    private readonly links: WhatsappLinkService,
    private readonly conversation: ConversationService,
    private readonly client: WaAkgClient,
  ) {}

  /**
   * Processa um evento ja autenticado pela assinatura. Nunca lanca: falhas viram log sem texto.
   * O dono da conta vem so do vinculo (jid -> userId), nunca do corpo.
   */
  async handleInbound(event: unknown): Promise<void> {
    try {
      await this.process(event);
    } catch (error) {
      this.logger.warn(`whatsapp inbound falhou: ${(error as Error).name}`);
    }
  }

  private async process(event: unknown): Promise<void> {
    const message = parseInbound(event, this.config.get<string>('whatsapp.waAkgSessionId') ?? '');
    if (!message) return;

    const jidHash = sha256(message.jid);
    const rate = await this.cache.hitRateLimitWindow(`whatsapp:rate:${jidHash}`, RATE_WINDOW_MS);
    if (rate && rate.hits > RATE_MAX_HITS) return;

    const userId = await this.links.findUserIdByJid(message.jid);
    if (!userId) {
      // Sem Redis, numero sem vinculo fica mudo (falha fechada).
      if (!rate) return;
      await this.handleUnlinked(message, jidHash);
      return;
    }

    await this.handleLinked(message, userId);
  }

  private async handleUnlinked(message: InboundMessage, jidHash: string): Promise<void> {
    if (message.type !== 'text') return;

    if (looksLikeLinkCode(message.content)) {
      // A tentativa e contada antes do resgate (INCR atomico): tentativas em paralelo nao furam o limite.
      const attempts = await this.cache.hitRateLimitWindow(`whatsapp:linkfail:${jidHash}`, LINK_FAIL_WINDOW_MS);
      if (!attempts || attempts.hits > LINK_FAIL_MAX) return;

      const linked = await this.links.redeem(message.jid, message.content);
      await this.send(message.jid, [linked ? WHATSAPP_TEXTS.linked : WHATSAPP_TEXTS.linkFailed]);
      return;
    }

    // Orientacao: no maximo uma por hora por numero. Hits > 1 = ja enviada nesta janela.
    const hint = await this.cache.hitRateLimitWindow(`whatsapp:hint:${jidHash}`, HINT_WINDOW_MS);
    if (hint && hint.hits === 1) {
      await this.send(message.jid, [WHATSAPP_TEXTS.hint]);
    }
  }

  private async handleLinked(message: InboundMessage, userId: string): Promise<void> {
    if (message.type !== 'text') {
      await this.send(message.jid, [WHATSAPP_TEXTS.media]);
      return;
    }

    const text = message.content.trim();
    if (normalizeCommand(text) === UNLINK_COMMAND) {
      await this.links.unlinkByUserId(userId);
      await this.send(message.jid, [WHATSAPP_TEXTS.unlinked]);
      return;
    }
    if (text.length === 0) {
      await this.send(message.jid, [WHATSAPP_TEXTS.empty]);
      return;
    }
    if (text.length > MAX_TEXT_CHARS) {
      await this.send(message.jid, [WHATSAPP_TEXTS.tooLong]);
      return;
    }

    const reply: ConversationReply = await this.conversation.handleMessage({
      userId,
      channel: 'WHATSAPP',
      messageId: message.messageId,
      text: message.content,
      receivedAt: new Date(),
    });
    // Duplicata: o motor ja respondeu a primeira vez; reenviar repetiria a mesma resposta.
    if (reply.kind === 'DUPLICATE') return;

    await this.send(message.jid, formatReplyForWhatsapp(reply));
  }

  /** Envia partes em ordem. Falha para no meio: loga sem texto e nao lanca. */
  private async send(jid: string, parts: string[]): Promise<void> {
    for (const part of parts) {
      try {
        await this.client.sendText(jid, part);
      } catch (error) {
        this.logger.warn(`whatsapp envio falhou para ${maskJid(jid)}: ${(error as Error).message}`);
        return;
      }
    }
  }
}
