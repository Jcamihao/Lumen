import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthChallengeType } from "@prisma/client";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { VerifyLoginMfaDto } from "../dto/verify-login-mfa.dto";
import { AuthTokensResponse, SessionContext } from "../session/session.types";
import { TokenIssuerService } from "../session/token-issuer.service";
import { MfaCodeVerifier } from "./mfa-code-verifier.service";
import { isOpenChallenge, WITH_FULL_USER } from "./challenge-helpers";
import { MfaGate } from "./mfa-gate";

const DEFAULT_CHALLENGE_SECONDS = 300;
const BYPASS_TTL_MS = 10 * 60 * 1_000;

/** Segunda etapa do login com MFA: desafio, codigo do autenticador e codigo de recuperacao por email. */
@Injectable()
export class MfaLoginService {
  private readonly logger = new Logger(MfaLoginService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly gate: MfaGate,
    private readonly verifier: MfaCodeVerifier,
    private readonly tokens: TokenIssuerService,
  ) {}

  async createChallenge(userId: string, sessionContext: SessionContext) {
    await this.prisma.authChallenge.deleteMany({ where: { userId, type: AuthChallengeType.MFA_LOGIN } });
    const seconds =
      this.config.get<number>("auth.mfaChallengeExpiresInSeconds", DEFAULT_CHALLENGE_SECONDS) ??
      DEFAULT_CHALLENGE_SECONDS;
    return this.prisma.authChallenge.create({
      data: {
        userId,
        type: AuthChallengeType.MFA_LOGIN,
        expiresAt: new Date(Date.now() + seconds * 1_000),
        ipAddress: sessionContext.ipAddress,
        userAgent: sessionContext.userAgent,
      },
    });
  }

  async verifyLogin(dto: VerifyLoginMfaDto, request?: RequestWithContext): Promise<AuthTokensResponse> {
    this.gate.assertFeatureEnabled();
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { id: dto.challengeId },
      include: WITH_FULL_USER,
    });
    if (!isOpenChallenge(challenge, AuthChallengeType.MFA_LOGIN)) {
      throw new UnauthorizedException("O desafio de autenticacao expirou ou nao e mais valido.");
    }

    await this.verifier.verifyAndPersist(challenge.user, dto.code);
    await this.prisma.authChallenge.update({ where: { id: challenge.id }, data: { completedAt: new Date() } });
    await this.users.updateLastLogin(challenge.user.id);
    this.logger.log(`login_mfa_success userId=${challenge.user.id} challengeId=${challenge.id}`);
    return this.tokens.issueForUser(challenge.user, request);
  }
}
