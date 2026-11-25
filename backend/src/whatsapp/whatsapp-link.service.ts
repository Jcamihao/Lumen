import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationChannel } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { maskJid } from './whatsapp-mask';

export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LINK_CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 10 * 60_000;
const LINK_CODE_SHAPE = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);
const REQUIRED_WHEN_ENABLED = [
  ['waAkgBaseUrl', 'WA_AKG_BASE_URL'],
  ['waAkgApiKey', 'WA_AKG_API_KEY'],
  ['waAkgSessionId', 'WA_AKG_SESSION_ID'],
  ['waAkgWebhookSecret', 'WA_AKG_WEBHOOK_SECRET'],
] as const;

export function hashLinkCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex');
}

/** Aceita "abcd-efgh" ou "ABCD EFGH": tira espacos e hifens e poe em maiusculas. */
export function normalizeLinkCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

/** Formato do codigo de vinculo (8 caracteres do alfabeto), depois de normalizar. */
export function looksLikeLinkCode(raw: string): boolean {
  return LINK_CODE_SHAPE.test(normalizeLinkCode(raw));
}

function coded(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

@Injectable()
export class WhatsappLinkService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Recusa subir com WHATSAPP_ENABLED=true e configuracao incompleta. Lista so os nomes das variaveis. */
  onModuleInit() {
    if (!this.isEnabled()) {
      return;
    }
    const missing = REQUIRED_WHEN_ENABLED.filter(([key]) => !this.config.get<string>(`whatsapp.${key}`)).map(
      ([, envName]) => envName,
    );
    if (missing.length > 0) {
      throw new Error(`WHATSAPP_ENABLED=true mas faltam variaveis: ${missing.join(', ')}`);
    }
  }

  isEnabled(): boolean {
    return this.config.get<boolean>('whatsapp.enabled') === true;
  }

  async createCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    if (!this.isEnabled()) {
      throw coded(HttpStatus.SERVICE_UNAVAILABLE, 'WHATSAPP_DISABLED', 'O canal WhatsApp está desligado.');
    }
    const existing = await this.prisma.whatsappLink.findUnique({ where: { userId }, select: { id: true } });
    if (existing) {
      throw coded(HttpStatus.CONFLICT, 'WHATSAPP_ALREADY_LINKED', 'Esta conta já tem um WhatsApp vinculado.');
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    // Codigos anteriores ainda nao usados deixam de valer: so o mais recente funciona.
    await this.prisma.$transaction([
      this.prisma.whatsappLinkCode.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.whatsappLinkCode.create({
        data: { userId, codeHash: hashLinkCode(code), expiresAt },
      }),
    ]);
    return { code, expiresAt };
  }

  /**
   * Tenta vincular o jid a conta do codigo. Consome o codigo de forma condicional antes de criar o vinculo.
   * Retorna true/false sem dizer o motivo.
   */
  async redeem(jid: string, rawCode: string): Promise<boolean> {
    if (!this.isEnabled() || !looksLikeLinkCode(rawCode)) {
      return false;
    }
    const now = new Date();
    const codeHash = hashLinkCode(normalizeLinkCode(rawCode));
    const candidate = await this.prisma.whatsappLinkCode.findFirst({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
    if (!candidate) {
      return false;
    }

    const consumed = await this.prisma.whatsappLinkCode.updateMany({
      where: { id: candidate.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      return false;
    }

    // Codigo fica consumido mesmo se o vinculo for recusado: a tentativa nao vira oraculo de conta.
    const [jidTaken, userLinked] = await Promise.all([
      this.prisma.whatsappLink.findUnique({ where: { jid }, select: { id: true } }),
      this.prisma.whatsappLink.findUnique({ where: { userId: candidate.userId }, select: { id: true } }),
    ]);
    if (jidTaken || userLinked) {
      return false;
    }

    try {
      await this.prisma.whatsappLink.create({ data: { userId: candidate.userId, jid, linkedAt: now } });
      return true;
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async getStatus(userId: string) {
    const enabled = this.isEnabled();
    const link = await this.prisma.whatsappLink.findUnique({ where: { userId }, select: { jid: true, linkedAt: true } });
    return {
      enabled,
      linked: Boolean(link),
      ...(link ? { linkedAt: link.linkedAt, maskedNumber: maskJid(link.jid) } : {}),
      ...(enabled ? { contactNumber: this.config.get<string>('whatsapp.contactNumber') || undefined } : {}),
    };
  }

  /** Desvincula e apaga a sessao WHATSAPP do usuario. Idempotente. Eventos ficam (sem texto). */
  async unlinkByUserId(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.whatsappLink.deleteMany({ where: { userId } }),
      this.prisma.conversationSession.deleteMany({ where: { userId, channel: ConversationChannel.WHATSAPP } }),
    ]);
  }

  /** Dono do jid, so pelo servidor. Null = sem vinculo. */
  async findUserIdByJid(jid: string): Promise<string | null> {
    const link = await this.prisma.whatsappLink.findUnique({ where: { jid }, select: { userId: true } });
    return link?.userId ?? null;
  }
}

function generateCode(): string {
  let code = '';
  for (let index = 0; index < LINK_CODE_LENGTH; index += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}
