import {
  AuthChallengeType,
  AuthSession,
  UserRole,
} from "@prisma/client";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { RequestWithContext } from "../common/interfaces/request-with-context.interface";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { VerifyLoginMfaDto } from "./dto/verify-login-mfa.dto";
import { MfaRecoveryCodeRecord, MfaService } from "./mfa.service";

type SessionContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

type UserRecord = Awaited<ReturnType<UsersService["findById"]>>;

type AuthTokensResponse = {
  accessToken: string;
  refreshToken: string;
  user: Awaited<ReturnType<UsersService["sanitizeUser"]>>;
};

type LoginMfaChallengeResponse = {
  requiresMfa: true;
  challengeId: string;
  challengeExpiresAt: string;
  availableMethods: Array<"totp" | "recovery_code">;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
    private readonly mfaService: MfaService,
  ) {}

  async register(dto: RegisterDto, request?: RequestWithContext) {
    if (!dto.privacyNoticeAccepted) {
      throw new BadRequestException(
        "E necessario aceitar o aviso de privacidade para criar a conta.",
      );
    }

    const normalizedEmail = dto.email.toLowerCase().trim();
    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new BadRequestException("Ja existe uma conta com este email.");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.createUser({
      name: dto.name,
      email: normalizedEmail,
      passwordHash,
      avatarUrl: dto.avatarUrl,
      preferredCurrency: dto.preferredCurrency ?? "BRL",
      monthlyIncome: dto.monthlyIncome,
      monthClosingDay: dto.monthClosingDay ?? 30,
      timezone: dto.timezone ?? "America/Sao_Paulo",
      privacyNoticeAccepted: dto.privacyNoticeAccepted,
      aiAssistantEnabled: dto.aiAssistantEnabled ?? false,
    });

    this.logger.log(`register_success userId=${user.id} email=${user.email}`);
    void this.mailService
      .sendWelcomeEmail({
        email: user.email,
        name: user.name,
      })
      .catch((error) => {
        this.logger.warn(
          `welcome_email_failed userId=${user.id} email=${user.email} reason=${this.getErrorMessage(error)}`,
        );
      });

    return this.issueTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      user,
      sessionContext: this.extractSessionContext(request),
    });
  }

  async login(
    dto: LoginDto,
    request?: RequestWithContext,
  ): Promise<AuthTokensResponse | LoginMfaChallengeResponse> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      throw new UnauthorizedException("Credenciais invalidas.");
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("Credenciais invalidas.");
    }

    if (this.isMfaFeatureEnabled() && this.isMfaEnabled(user)) {
      const challenge = await this.createMfaLoginChallenge(
        user.id,
        this.extractSessionContext(request),
      );

      return {
        requiresMfa: true,
        challengeId: challenge.id,
        challengeExpiresAt: challenge.expiresAt.toISOString(),
        availableMethods: ["totp", "recovery_code"],
      };
    }

    await this.usersService.updateLastLogin(user.id);
    this.logger.log(`login_success userId=${user.id} email=${user.email}`);

    return this.issueTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      user,
      sessionContext: this.extractSessionContext(request),
    });
  }

  async verifyLoginMfa(
    dto: VerifyLoginMfaDto,
    request?: RequestWithContext,
  ): Promise<AuthTokensResponse> {
    this.assertMfaFeatureEnabled();

    const challenge = await this.prisma.authChallenge.findUnique({
      where: { id: dto.challengeId },
      include: {
        user: {
          include: {
            taskCategories: {
              orderBy: { name: "asc" },
            },
            financeCategories: {
              orderBy: { name: "asc" },
            },
          },
        },
      },
    });

    if (
      !challenge ||
      challenge.type !== AuthChallengeType.MFA_LOGIN ||
      challenge.completedAt ||
      challenge.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        "O desafio de autenticacao expirou ou nao e mais valido.",
      );
    }

    await this.verifyAndPersistMfaCode(challenge.user, dto.code);

    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: {
        completedAt: new Date(),
      },
    });
    await this.usersService.updateLastLogin(challenge.user.id);
    this.logger.log(
      `login_mfa_success userId=${challenge.user.id} challengeId=${challenge.id}`,
    );

    return this.issueTokens({
      userId: challenge.user.id,
      email: challenge.user.email,
      role: challenge.user.role,
      user: challenge.user,
      sessionContext: this.extractSessionContext(request),
    });
  }

  async startMfaSetup(userId: string) {
    this.assertMfaFeatureEnabled();
    const user = await this.usersService.findById(userId);

    if (this.isMfaEnabled(user)) {
      throw new BadRequestException(
        "O MFA ja esta ativo para esta conta. Desative antes de configurar novamente.",
      );
    }

    const secret = this.mfaService.generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaPendingTotpSecretEncrypted: this.mfaService.encryptSecret(secret),
      },
    });

    return {
      secret,
      otpauthUrl: this.mfaService.buildOtpAuthUrl(user.email, secret),
      issuer: this.configService.get<string>("auth.mfaIssuer") ?? "LUMEN",
      accountName: user.email,
    };
  }

  async confirmMfaSetup(userId: string, dto: MfaCodeDto) {
    this.assertMfaFeatureEnabled();
    const user = await this.usersService.findById(userId);

    if (!user.mfaPendingTotpSecretEncrypted) {
      throw new BadRequestException(
        "Nao ha configuracao de MFA pendente para confirmar.",
      );
    }

    const secret = this.mfaService.decryptSecret(
      user.mfaPendingTotpSecretEncrypted,
    );

    if (!this.mfaService.verifyTotpCode(secret, dto.code)) {
      throw new BadRequestException(
        "Codigo MFA invalido. Confira o codigo do autenticador e tente novamente.",
      );
    }

    const { plainCodes, hashedCodes } =
      await this.mfaService.generateRecoveryCodes();
    const now = new Date();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabledAt: user.mfaEnabledAt ?? now,
        mfaLastVerifiedAt: now,
        mfaTotpSecretEncrypted: this.mfaService.encryptSecret(secret),
        mfaPendingTotpSecretEncrypted: null,
        mfaRecoveryCodes: hashedCodes,
      },
    });

    return {
      success: true,
      recoveryCodes: plainCodes,
      user: await this.usersService.getMe(userId),
    };
  }

  async regenerateMfaRecoveryCodes(userId: string, dto: MfaCodeDto) {
    this.assertMfaFeatureEnabled();
    const user = await this.usersService.findById(userId);
    this.assertMfaIsConfigured(user);

    await this.verifyAndPersistMfaCode(user, dto.code);
    const { plainCodes, hashedCodes } =
      await this.mfaService.generateRecoveryCodes();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaRecoveryCodes: hashedCodes,
      },
    });

    return {
      success: true,
      recoveryCodes: plainCodes,
      user: await this.usersService.getMe(userId),
    };
  }

  async disableMfa(userId: string, dto: MfaCodeDto) {
    this.assertMfaFeatureEnabled();
    const user = await this.usersService.findById(userId);
    this.assertMfaIsConfigured(user);
    await this.verifyAndPersistMfaCode(user, dto.code);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabledAt: null,
        mfaLastVerifiedAt: null,
        mfaTotpSecretEncrypted: null,
        mfaPendingTotpSecretEncrypted: null,
        mfaRecoveryCodes: null,
      },
    });

    return {
      success: true,
      user: await this.usersService.getMe(userId),
    };
  }

  async refresh(dto: RefreshDto, request?: RequestWithContext) {
    const refreshToken = this.resolveRefreshToken(dto, request);
    const refreshSecret = this.configService.getOrThrow<string>(
      "auth.refreshSecret",
    );
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: refreshSecret,
      });
    } catch (_error) {
      throw new UnauthorizedException("Refresh token invalido.");
    }

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
      },
    });

    this.assertSessionIsUsable(session);

    const isValidRefreshToken = await bcrypt.compare(
      refreshToken,
      session.refreshTokenHash,
    );

    if (!isValidRefreshToken) {
      await this.revokeSession(session.id, "refresh_token_reuse_detected");
      throw new UnauthorizedException("Refresh token invalido.");
    }

    const user = await this.usersService.findById(payload.sub);

    return this.issueTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      user,
      sessionContext: this.extractSessionContext(request),
      existingSessionId: session.id,
    });
  }

  async logout(userId: string, sessionId: string) {
    await this.revokeSession(sessionId, "logout", userId);

    return {
      success: true,
      loggedOutAt: new Date().toISOString(),
    };
  }

  async logoutAll(userId: string) {
    const revokedAt = new Date();
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt,
        revokeReason: "logout_all",
      },
    });

    return {
      success: true,
      revokedSessions: result.count,
      loggedOutAt: revokedAt.toISOString(),
    };
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId);
    return this.usersService.sanitizeUser(user);
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private isMfaFeatureEnabled() {
    return this.configService.get<boolean>("auth.mfaEnabled") ?? false;
  }

  private assertMfaFeatureEnabled() {
    if (this.isMfaFeatureEnabled()) {
      return;
    }

    throw new ServiceUnavailableException(
      "O MFA esta temporariamente indisponivel neste ambiente.",
    );
  }

  private isMfaEnabled(user: {
    mfaEnabledAt?: Date | null;
    mfaTotpSecretEncrypted?: string | null;
  }) {
    return Boolean(user.mfaEnabledAt && user.mfaTotpSecretEncrypted);
  }

  private assertMfaIsConfigured(user: {
    mfaEnabledAt?: Date | null;
    mfaTotpSecretEncrypted?: string | null;
  }) {
    if (!this.isMfaEnabled(user)) {
      throw new BadRequestException(
        "O MFA ainda nao esta ativo para esta conta.",
      );
    }
  }

  private async createMfaLoginChallenge(
    userId: string,
    sessionContext: SessionContext,
  ) {
    await this.prisma.authChallenge.deleteMany({
      where: {
        userId,
        type: AuthChallengeType.MFA_LOGIN,
      },
    });

    const expiresAt = new Date(
      Date.now() +
        (this.configService.get<number>(
          "auth.mfaChallengeExpiresInSeconds",
          300,
        ) ?? 300) *
          1_000,
    );

    return this.prisma.authChallenge.create({
      data: {
        userId,
        type: AuthChallengeType.MFA_LOGIN,
        expiresAt,
        ipAddress: sessionContext.ipAddress,
        userAgent: sessionContext.userAgent,
      },
    });
  }

  private async verifyAndPersistMfaCode(user: UserRecord, code: string) {
    const secret = user.mfaTotpSecretEncrypted
      ? this.mfaService.decryptSecret(user.mfaTotpSecretEncrypted)
      : null;

    if (secret && this.mfaService.verifyTotpCode(secret, code)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          mfaLastVerifiedAt: new Date(),
        },
      });
      return;
    }

    const recoveryCodes = this.mfaService.parseRecoveryCodeRecords(
      user.mfaRecoveryCodes,
    );
    const { matched, updatedRecords } = await this.mfaService.consumeRecoveryCode(
      code,
      recoveryCodes,
    );

    if (!matched) {
      throw new UnauthorizedException(
        "Codigo MFA invalido. Use um codigo do autenticador ou um codigo de recuperacao valido.",
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaLastVerifiedAt: new Date(),
        mfaRecoveryCodes: updatedRecords,
      },
    });
  }

  private assertSessionIsUsable(
    session: AuthSession | null,
  ): asserts session is AuthSession {
    if (!session || session.revokedAt) {
      throw new UnauthorizedException("Sessao autenticada invalida.");
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException("Sessao autenticada expirada.");
    }
  }

  private extractSessionContext(request?: RequestWithContext): SessionContext {
    const forwardedFor = request?.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0];
    const rawIp = forwardedIp?.trim() || request?.ip || null;
    const rawUserAgent = request?.headers["user-agent"];
    const userAgent = Array.isArray(rawUserAgent)
      ? rawUserAgent[0]
      : rawUserAgent ?? null;

    return {
      ipAddress: rawIp ? rawIp.slice(0, 120) : null,
      userAgent: userAgent ? userAgent.slice(0, 512) : null,
    };
  }

  private resolveRefreshToken(dto: RefreshDto, request?: RequestWithContext) {
    const bodyRefreshToken = dto.refreshToken?.trim();

    if (bodyRefreshToken) {
      return bodyRefreshToken;
    }

    const cookieName = this.configService.get<string>("auth.refreshCookieName");
    const cookieRefreshToken = cookieName
      ? this.getCookieValue(request, cookieName)
      : null;

    if (cookieRefreshToken) {
      return cookieRefreshToken;
    }

    throw new UnauthorizedException("Refresh token ausente.");
  }

  private getCookieValue(
    request: RequestWithContext | undefined,
    cookieName: string,
  ) {
    const rawCookieHeader = request?.headers.cookie;
    const headerValue = Array.isArray(rawCookieHeader)
      ? rawCookieHeader.join(";")
      : rawCookieHeader;

    if (!headerValue) {
      return null;
    }

    const cookieEntry = headerValue
      .split(";")
      .map((chunk) => chunk.trim())
      .find((chunk) => chunk.startsWith(`${cookieName}=`));

    if (!cookieEntry) {
      return null;
    }

    return decodeURIComponent(cookieEntry.slice(cookieName.length + 1));
  }

  private parseDurationToMs(value: string) {
    const normalizedValue = value.trim().toLowerCase();
    const match = normalizedValue.match(/^(\d+)(ms|s|m|h|d)$/);

    if (!match) {
      throw new Error(
        `Duracao JWT invalida: "${value}". Use formatos como 15m, 12h ou 7d.`,
      );
    }

    const amount = Number(match[1]);
    const unit = match[2];

    switch (unit) {
      case "ms":
        return amount;
      case "s":
        return amount * 1_000;
      case "m":
        return amount * 60_000;
      case "h":
        return amount * 3_600_000;
      case "d":
        return amount * 86_400_000;
      default:
        throw new Error(`Unidade de duracao JWT nao suportada: "${unit}".`);
    }
  }

  private async revokeSession(
    sessionId: string,
    revokeReason: string,
    userId?: string,
  ) {
    await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        ...(userId ? { userId } : {}),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokeReason,
      },
    });
  }

  private async issueTokens(input: {
    userId: string;
    email: string;
    role: UserRole;
    user: UserRecord;
    sessionContext: SessionContext;
    existingSessionId?: string;
  }): Promise<AuthTokensResponse> {
    const accessSecret = this.configService.getOrThrow<string>(
      "auth.accessSecret",
    );
    const refreshSecret = this.configService.getOrThrow<string>(
      "auth.refreshSecret",
    );
    const accessExpiresIn =
      this.configService.get<string>("auth.accessExpiresIn") ?? "15m";
    const refreshExpiresIn =
      this.configService.get<string>("auth.refreshExpiresIn") ?? "7d";
    const sessionId = input.existingSessionId ?? randomUUID();
    const payload: JwtPayload = {
      sub: input.userId,
      email: input.email,
      role: input.role,
      sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      }),
    ]);

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.parseDurationToMs(refreshExpiresIn),
    );

    if (input.existingSessionId) {
      const result = await this.prisma.authSession.updateMany({
        where: {
          id: input.existingSessionId,
          userId: input.userId,
          revokedAt: null,
        },
        data: {
          refreshTokenHash,
          expiresAt,
          ipAddress: input.sessionContext.ipAddress,
          userAgent: input.sessionContext.userAgent,
          lastUsedAt: now,
          revokeReason: null,
        },
      });

      if (result.count === 0) {
        throw new UnauthorizedException("Sessao autenticada invalida.");
      }
    } else {
      await this.prisma.authSession.create({
        data: {
          id: sessionId,
          userId: input.userId,
          refreshTokenHash,
          expiresAt,
          ipAddress: input.sessionContext.ipAddress,
          userAgent: input.sessionContext.userAgent,
          lastUsedAt: now,
        },
      });
    }

    return {
      accessToken,
      refreshToken,
      user: await this.usersService.sanitizeUser(input.user),
    };
  }
}
