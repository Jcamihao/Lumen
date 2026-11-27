import { randomInt } from "crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { AuthChallengeType } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { MailService } from "../../mail/mail.service";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { RequestEmailMfaBypassDto } from "../dto/request-email-mfa-bypass.dto";
import { VerifyEmailMfaBypassDto } from "../dto/verify-email-mfa-bypass.dto";
import { errorMessage } from "../error-message";
import { extractSessionContext } from "../session/session-context";
import { AuthTokensResponse, SessionContext } from "../session/session.types";
import { TokenIssuerService } from "../session/token-issuer.service";
import { isOpenChallenge, WITH_FULL_USER } from "./challenge-helpers";
import { MfaGate } from "./mfa-gate";

const BYPASS_TTL_MS = 10 * 60 * 1_000;

/** Entrar sem o autenticador: codigo de 6 digitos enviado por email, valido por 10 minutos. */
@Injectable()
export class MfaEmailBypassService {
  private readonly logger = new Logger(MfaEmailBypassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly gate: MfaGate,
    private readonly tokens: TokenIssuerService,
  ) {}

  async request(dto: RequestEmailMfaBypassDto, request?: RequestWithContext) {
    this.gate.assertFeatureEnabled();
    const loginChallenge = await this.prisma.authChallenge.findUnique({
      where: { id: dto.challengeId },
      include: { user: true },
    });
    if (!isOpenChallenge(loginChallenge, AuthChallengeType.MFA_LOGIN)) {
      throw new UnauthorizedException("O desafio de autenticacao expirou ou nao e mais valido.");
    }

    const otp = String(randomInt(100000, 1000000));
    const tokenHash = await bcrypt.hash(otp, 10);
    const bypassChallenge = await this.replaceBypassChallenge(loginChallenge.userId, tokenHash, extractSessionContext(request));
    this.sendBypassEmail(loginChallenge.user, otp);

    this.logger.log(
      `mfa_email_bypass_requested userId=${loginChallenge.userId} bypassChallengeId=${bypassChallenge.id}`,
    );
    return { bypassChallengeId: bypassChallenge.id, expiresAt: bypassChallenge.expiresAt.toISOString() };
  }

  private async replaceBypassChallenge(userId: string, tokenHash: string, sessionContext: SessionContext) {
    await this.prisma.authChallenge.deleteMany({
      where: { userId, type: AuthChallengeType.MFA_EMAIL_BYPASS, completedAt: null },
    });
    return this.prisma.authChallenge.create({
      data: {
        userId,
        type: AuthChallengeType.MFA_EMAIL_BYPASS,
        token: tokenHash,
        expiresAt: new Date(Date.now() + BYPASS_TTL_MS),
        ipAddress: sessionContext.ipAddress,
        userAgent: sessionContext.userAgent,
      },
    });
  }

  private sendBypassEmail(user: { id: string; email: string; name: string }, otp: string) {
    void this.mail.sendMfaBypassEmail({ email: user.email, name: user.name, otp }).catch((error) => {
      this.logger.warn(`mfa_bypass_email_failed userId=${user.id} reason=${errorMessage(error)}`);
    });
  }

  async verify(dto: VerifyEmailMfaBypassDto, request?: RequestWithContext): Promise<AuthTokensResponse> {
    this.gate.assertFeatureEnabled();
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { id: dto.bypassChallengeId },
      include: WITH_FULL_USER,
    });
    if (!isOpenChallenge(challenge, AuthChallengeType.MFA_EMAIL_BYPASS) || !challenge.token) {
      throw new UnauthorizedException("O codigo de recuperacao expirou ou nao e mais valido.");
    }
    if (!(await bcrypt.compare(dto.code, challenge.token))) {
      throw new UnauthorizedException("Codigo de recuperacao invalido.");
    }

    await this.prisma.authChallenge.update({ where: { id: challenge.id }, data: { completedAt: new Date() } });
    await this.users.updateLastLogin(challenge.user.id);
    this.logger.log(`mfa_email_bypass_success userId=${challenge.user.id} challengeId=${challenge.id}`);
    return this.tokens.issueForUser(challenge.user, request);
  }
}
