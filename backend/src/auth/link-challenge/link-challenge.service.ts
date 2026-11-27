import { randomBytes } from "crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthChallengeType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { hashSecret, safeEqual } from "../session/secret-hash";
import { SessionContext } from "../session/session.types";

export type LinkChallenge = { challengeId: string; secret: string };

/**
 * Desafio de link por email (reset de senha, confirmacao de email). O segredo tem 256 bits
 * de entropia, entao basta um sha256 no banco (bcrypt nao agrega e trunca em 72 bytes).
 * So um desafio pendente por usuario/tipo: pedir de novo invalida o link anterior.
 */
@Injectable()
export class LinkChallengeService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async create(
    userId: string,
    type: AuthChallengeType,
    ttlMs: number,
    sessionContext: SessionContext,
  ): Promise<LinkChallenge> {
    const secret = randomBytes(32).toString("base64url");

    await this.prisma.authChallenge.deleteMany({ where: { userId, type, completedAt: null } });
    const challenge = await this.prisma.authChallenge.create({
      data: {
        userId,
        type,
        token: hashSecret(secret),
        expiresAt: new Date(Date.now() + ttlMs),
        ipAddress: sessionContext.ipAddress,
        userAgent: sessionContext.userAgent,
      },
    });
    return { challengeId: challenge.id, secret };
  }

  /** Valida e consome (uso unico) um desafio de link; devolve o userId. */
  async consume(challengeId: string, secret: string, type: AuthChallengeType): Promise<string> {
    const invalid = new BadRequestException("Link invalido ou expirado.");
    const challenge = await this.prisma.authChallenge.findUnique({ where: { id: challengeId } });

    if (
      !challenge ||
      challenge.type !== type ||
      challenge.completedAt ||
      challenge.expiresAt <= new Date() ||
      !challenge.token
    ) {
      throw invalid;
    }
    if (!safeEqual(challenge.token, hashSecret(secret))) throw invalid;

    // updateMany com completedAt:null evita que dois cliques simultaneos consumam o mesmo link.
    const consumed = await this.prisma.authChallenge.updateMany({
      where: { id: challenge.id, completedAt: null },
      data: { completedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;

    return challenge.userId;
  }

  buildFrontendLink(path: string, link: LinkChallenge): string {
    const frontendUrl = this.config.get<string>("app.frontendUrl") ?? "http://localhost:4200";
    return `${frontendUrl}${path}?id=${link.challengeId}&token=${encodeURIComponent(link.secret)}`;
  }
}
