import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthSession } from "@prisma/client";
import { JwtPayload } from "../../common/interfaces/jwt-payload.interface";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { RefreshDto } from "../dto/refresh.dto";
import { resolveRefreshToken } from "./refresh-token-source";
import { isRefreshTokenAccepted, recentRetiredRefreshTokens } from "./secret-hash";
import { extractSessionContext } from "./session-context";
import { RefreshRotationConflictError, RetiredRefreshToken } from "./session.types";
import { TokenIssuerService } from "./token-issuer.service";

const REFRESH_ROTATION_MAX_ATTEMPTS = 6;
const REFRESH_RETIRED_KEEP = 10;
const DEFAULT_REUSE_GRACE_SECONDS = 30;

function assertSessionIsUsable(session: AuthSession | null): asserts session is AuthSession {
  if (!session || session.revokedAt) throw new UnauthorizedException("Sessao autenticada invalida.");
  if (session.expiresAt <= new Date()) throw new UnauthorizedException("Sessao autenticada expirada.");
}

/** Hash vigente esperado e a lista de aposentados (mais recentes) que vale depois da troca. */
function rotationFor(session: AuthSession, recent: RetiredRefreshToken[]) {
  const retired = [...recent, { hash: session.refreshTokenHash, retiredAt: Date.now() }];
  return { expectedRefreshTokenHash: session.refreshTokenHash, retired: retired.slice(-REFRESH_RETIRED_KEEP) };
}

/** Renovacao (rotacao do refresh token), logout e revogacao de sessoes. */
@Injectable()
export class SessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenIssuerService,
  ) {}

  async refresh(dto: RefreshDto, request?: RequestWithContext) {
    const refreshToken = resolveRefreshToken(dto, request, this.config.get<string>("auth.refreshCookieName"));
    const payload = await this.verifyRefreshJwt(refreshToken);

    // Varias tentativas: se outra requisicao rotacionou entre a leitura e a escrita (abas
    // abrindo juntas), na releitura o token apresentado ja esta entre os aposentados
    // recentes. Uma tentativa por requisicao concorrente no pior caso.
    for (let attempt = 0; attempt < REFRESH_ROTATION_MAX_ATTEMPTS; attempt += 1) {
      const rotated = await this.tryRotate(payload, refreshToken, request);
      if (rotated) return rotated;
    }
    throw new UnauthorizedException("Refresh token invalido.");
  }

  private async verifyRefreshJwt(refreshToken: string): Promise<JwtPayload> {
    const refreshSecret = this.config.getOrThrow<string>("auth.refreshSecret");
    try {
      return await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: refreshSecret });
    } catch (_error) {
      throw new UnauthorizedException("Refresh token invalido.");
    }
  }

  /** Uma tentativa de rotacao. Devolve os tokens novos, ou null se houve conflito e deve repetir. */
  private async tryRotate(payload: JwtPayload, refreshToken: string, request?: RequestWithContext) {
    const session = await this.prisma.authSession.findFirst({
      where: { id: payload.sessionId, userId: payload.sub },
    });
    assertSessionIsUsable(session);

    const graceSeconds = this.config.get<number>("auth.refreshReuseGraceSeconds") ?? DEFAULT_REUSE_GRACE_SECONDS;
    const recent = recentRetiredRefreshTokens(session.recentRefreshTokenHashes, graceSeconds);
    if (!(await isRefreshTokenAccepted(refreshToken, session.refreshTokenHash, recent))) {
      await this.revokeSession(session.id, "refresh_token_reuse_detected");
      throw new UnauthorizedException("Refresh token invalido.");
    }

    const user = await this.users.findById(payload.sub);
    try {
      return await this.tokens.issue({
        userId: user.id,
        email: user.email,
        role: user.role,
        user,
        sessionContext: extractSessionContext(request),
        existingSessionId: session.id,
        rotation: rotationFor(session, recent),
      });
    } catch (error) {
      if (!(error instanceof RefreshRotationConflictError)) throw error;
      return null;
    }
  }

  async logout(userId: string, sessionId: string) {
    await this.revokeSession(sessionId, "logout", userId);
    return { success: true, loggedOutAt: new Date().toISOString() };
  }

  async logoutAll(userId: string) {
    const revokedAt = new Date();
    const result = await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt, revokeReason: "logout_all" },
    });
    return { success: true, revokedSessions: result.count, loggedOutAt: revokedAt.toISOString() };
  }

  private async revokeSession(sessionId: string, revokeReason: string, userId?: string) {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, ...(userId ? { userId } : {}), revokedAt: null },
      data: { revokedAt: new Date(), revokeReason },
    });
  }
}
