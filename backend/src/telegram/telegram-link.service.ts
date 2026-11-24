import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationChannel } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LINK_CODE_ALPHABET, hashLinkCode, looksLikeLinkCode, normalizeLinkCode } from '../whatsapp/whatsapp-link.service';
import { maskChatId } from './telegram-mask';

const LINK_CODE_TTL_MS = 10 * 60_000;
const REQUIRED_WHEN_ENABLED = [['telegram.botToken', 'TELEGRAM_BOT_TOKEN']] as const;

function coded(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

/** chat.id chega como string digitada/serializada; so inteiro positivo em forma de digitos e usavel. */
function parseChatId(raw: string): bigint | null {
  if (!/^\d{1,19}$/.test(raw)) return null;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

/**
 * Vinculo chat do Telegram <-> conta Lumen (contrato 10, D1), espelho do WhatsappLinkService:
 * codigo de uso unico (o par de ferramentas de formato e o mesmo modulo do WhatsApp), hash no banco,
 * e a identidade do dono vem sempre da tabela, nunca do evento.
 */
@Injectable()
export class TelegramLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('telegram.enabled') === true;
  }

  async createCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    if (!this.isEnabled()) {
      throw coded(HttpStatus.SERVICE_UNAVAILABLE, 'TELEGRAM_DISABLED', 'O canal Telegram está desligado.');
    }
    const existing = await this.prisma.telegramLink.findUnique({ where: { userId }, select: { id: true } });
    if (existing) {
      throw coded(HttpStatus.CONFLICT, 'TELEGRAM_ALREADY_LINKED', 'Esta conta já tem um Telegram vinculado.');
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    // Codigos anteriores ainda nao usados deixam de valer: so o mais recente funciona.
    await this.prisma.$transaction([
      this.prisma.telegramLinkCode.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.telegramLinkCode.create({ data: { userId, codeHash: hashLinkCode(code), expiresAt } }),
    ]);
    return { code, expiresAt };
  }

  /** Tenta vincular o chat a conta do codigo. Consome o codigo antes de criar o vinculo (sem oracle). */
  async redeem(chatIdRaw: string, rawCode: string): Promise<boolean> {
    if (!this.isEnabled() || !looksLikeLinkCode(rawCode)) return false;
    const chatId = parseChatId(chatIdRaw);
    if (chatId === null) return false;

    const now = new Date();
    const codeHash = hashLinkCode(normalizeLinkCode(rawCode));
    const candidate = await this.prisma.telegramLinkCode.findFirst({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
    if (!candidate) return false;

    const consumed = await this.prisma.telegramLinkCode.updateMany({
      where: { id: candidate.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return false;

    // Codigo fica consumido mesmo se o vinculo for recusado: a tentativa nao vira oraculo de conta.
    const [chatTaken, userLinked] = await Promise.all([
      this.prisma.telegramLink.findUnique({ where: { chatId }, select: { id: true } }),
      this.prisma.telegramLink.findUnique({ where: { userId: candidate.userId }, select: { id: true } }),
    ]);
    if (chatTaken || userLinked) return false;

    try {
      await this.prisma.telegramLink.create({ data: { userId: candidate.userId, chatId, linkedAt: now } });
      return true;
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') return false;
      throw error;
    }
  }

  async getStatus(userId: string) {
    const enabled = this.isEnabled();
    const link = await this.prisma.telegramLink.findUnique({ where: { userId }, select: { chatId: true, linkedAt: true } });
    return {
      enabled,
      linked: Boolean(link),
      ...(link ? { linkedAt: link.linkedAt, maskedChatId: maskChatId(link.chatId) } : {}),
    };
  }

  /** Desvincula e apaga a sessao TELEGRAM do usuario. Idempotente. Eventos ficam (sem texto). */
  async unlinkByUserId(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.telegramLink.deleteMany({ where: { userId } }),
      this.prisma.conversationSession.deleteMany({ where: { userId, channel: ConversationChannel.TELEGRAM } }),
    ]);
  }

  /** Dono do chat, so pelo servidor. Null = sem vinculo ou chatId em forma impossivel. */
  async findUserIdByChatId(chatIdRaw: string): Promise<string | null> {
    const chatId = parseChatId(chatIdRaw);
    if (chatId === null) return null;
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId }, select: { userId: true } });
    return link?.userId ?? null;
  }
}

function generateCode(): string {
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}
