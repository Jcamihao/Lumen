import { randomUUID } from "crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { parseDurationToMs } from "./duration";
import { hashSecret } from "./secret-hash";
import { signTokenPair, tokenPayload } from "./token-signing";
import { extractSessionContext } from "./session-context";
import {
  AuthTokensResponse,
  IssueTokensInput,
  RefreshRotationConflictError,
  SessionTimes,
  UserRecord,
} from "./session.types";

/** Assina o par de tokens e grava (ou rotaciona) a sessao correspondente. */
@Injectable()
export class TokenIssuerService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** Abre uma sessao nova para o usuario (login, cadastro, MFA). */
  issueForUser(user: UserRecord, request?: RequestWithContext): Promise<AuthTokensResponse> {
    return this.issue({
      userId: user.id,
      email: user.email,
      role: user.role,
      user,
      sessionContext: extractSessionContext(request),
    });
  }

  async issue(input: IssueTokensInput): Promise<AuthTokensResponse> {
    const refreshExpiresIn = this.config.get<string>("auth.refreshExpiresIn") ?? "7d";
    const sessionId = input.existingSessionId ?? randomUUID();
    const { accessToken, refreshToken } = await signTokenPair(this.config, this.jwt, tokenPayload(input, sessionId), refreshExpiresIn);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + parseDurationToMs(refreshExpiresIn));
    const refreshTokenHash = hashSecret(refreshToken);

    if (input.existingSessionId) {
      await this.rotateSession(input, input.existingSessionId, { refreshTokenHash, expiresAt, now });
    } else {
      await this.createSession(input, sessionId, { refreshTokenHash, expiresAt, now });
    }
    return { accessToken, refreshToken, user: await this.users.sanitizeUser(input.user) };
  }

  private createSession(input: IssueTokensInput, sessionId: string, fresh: SessionTimes) {
    return this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: input.userId,
        refreshTokenHash: fresh.refreshTokenHash,
        expiresAt: fresh.expiresAt,
        ipAddress: input.sessionContext.ipAddress,
        userAgent: input.sessionContext.userAgent,
        lastUsedAt: fresh.now,
      },
    });
  }

  private async rotateSession(input: IssueTokensInput, sessionId: string, fresh: SessionTimes) {
    const result = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        userId: input.userId,
        revokedAt: null,
        ...(input.rotation ? { refreshTokenHash: input.rotation.expectedRefreshTokenHash } : {}),
      },
      data: {
        refreshTokenHash: fresh.refreshTokenHash,
        recentRefreshTokenHashes: input.rotation?.retired ?? [],
        expiresAt: fresh.expiresAt,
        ipAddress: input.sessionContext.ipAddress,
        userAgent: input.sessionContext.userAgent,
        lastUsedAt: fresh.now,
        revokeReason: null,
      },
    });
    if (result.count === 0) await this.failRotation(input, sessionId);
  }

  private async failRotation(input: IssueTokensInput, sessionId: string): Promise<never> {
    const stillActive = input.rotation
      ? await this.prisma.authSession.findFirst({
          where: { id: sessionId, userId: input.userId, revokedAt: null },
          select: { id: true },
        })
      : null;
    if (stillActive) throw new RefreshRotationConflictError();
    throw new UnauthorizedException("Sessao autenticada invalida.");
  }
}
