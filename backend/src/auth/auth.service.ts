import {
  AuthChallengeType,
  AuthSession,
  UserRole,
} from "@prisma/client";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { RequestWithContext } from "../common/interfaces/request-with-context.interface";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { RequestEmailMfaBypassDto } from "./dto/request-email-mfa-bypass.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { VerifyEmailMfaBypassDto } from "./dto/verify-email-mfa-bypass.dto";
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

type RetiredRefreshToken = { hash: string; retiredAt: number };

const REFRESH_ROTATION_MAX_ATTEMPTS = 6;
const REFRESH_RETIRED_KEEP = 10;

/** Outra requisicao rotacionou o refresh token no meio desta: refazer a leitura. */
class RefreshRotationConflictError extends Error {}

// Login com email inexistente tambem gasta um bcrypt.compare (mesmo custo dos hashes
// reais), senao o tempo de resposta revela quais emails tem conta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("lumen-timing-equalizer", 10);

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
      phone: dto.phone,
      birthDate: dto.birthDate,
      occupation: dto.occupation,
      primaryGoal: dto.primaryGoal,
      preferredCurrency: dto.preferredCurrency ?? "BRL",
      monthlyIncome: dto.monthlyIncome,
      monthClosingDay: dto.monthClosingDay ?? 30,
      timezone: dto.timezone ?? "America/Sao_Paulo",
      privacyNoticeAccepted: dto.privacyNoticeAccepted,
      aiAssistantEnabled: dto.aiAssistantEnabled ?? false,
    });

    this.logger.log(`register_success userId=${user.id} email=${user.email}`);
    void this.issueEmailVerificationLink(user.id, request)
      .then((verifyUrl) =>
        this.mailService.sendWelcomeEmail({
          email: user.email,
          name: user.name,
          verifyUrl,
        }),
      )
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
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
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
            tagGroups: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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

    const confirmedStep = this.mfaService.matchTotpStep(secret, dto.code);

    if (confirmedStep === null) {
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
        mfaLastTotpStep: confirmedStep,
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
        mfaLastTotpStep: null,
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

  async requestEmailMfaBypass(
    dto: RequestEmailMfaBypassDto,
    request?: RequestWithContext,
  ) {
    this.assertMfaFeatureEnabled();

    const loginChallenge = await this.prisma.authChallenge.findUnique({
      where: { id: dto.challengeId },
      include: { user: true },
    });

    if (
      !loginChallenge ||
      loginChallenge.type !== AuthChallengeType.MFA_LOGIN ||
      loginChallenge.completedAt ||
      loginChallenge.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        "O desafio de autenticacao expirou ou nao e mais valido.",
      );
    }

    const otp = String(randomInt(100000, 1000000));
    const tokenHash = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    const sessionContext = this.extractSessionContext(request);

    await this.prisma.authChallenge.deleteMany({
      where: {
        userId: loginChallenge.userId,
        type: AuthChallengeType.MFA_EMAIL_BYPASS,
        completedAt: null,
      },
    });

    const bypassChallenge = await this.prisma.authChallenge.create({
      data: {
        userId: loginChallenge.userId,
        type: AuthChallengeType.MFA_EMAIL_BYPASS,
        token: tokenHash,
        expiresAt,
        ipAddress: sessionContext.ipAddress,
        userAgent: sessionContext.userAgent,
      },
    });

    void this.mailService
      .sendMfaBypassEmail({
        email: loginChallenge.user.email,
        name: loginChallenge.user.name,
        otp,
      })
      .catch((error) => {
        this.logger.warn(
          `mfa_bypass_email_failed userId=${loginChallenge.userId} reason=${this.getErrorMessage(error)}`,
        );
      });

    this.logger.log(
      `mfa_email_bypass_requested userId=${loginChallenge.userId} bypassChallengeId=${bypassChallenge.id}`,
    );

    return {
      bypassChallengeId: bypassChallenge.id,
      expiresAt: bypassChallenge.expiresAt.toISOString(),
    };
  }

  async verifyEmailMfaBypass(
    dto: VerifyEmailMfaBypassDto,
    request?: RequestWithContext,
  ): Promise<AuthTokensResponse> {
    this.assertMfaFeatureEnabled();

    const challenge = await this.prisma.authChallenge.findUnique({
      where: { id: dto.bypassChallengeId },
      include: {
        user: {
          include: {
            taskCategories: { orderBy: { name: "asc" } },
            financeCategories: { orderBy: { name: "asc" } },
            tagGroups: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
          },
        },
      },
    });

    if (
      !challenge ||
      challenge.type !== AuthChallengeType.MFA_EMAIL_BYPASS ||
      challenge.completedAt ||
      challenge.expiresAt <= new Date() ||
      !challenge.token
    ) {
      throw new UnauthorizedException(
        "O codigo de recuperacao expirou ou nao e mais valido.",
      );
    }

    const codeMatches = await bcrypt.compare(dto.code, challenge.token);
    if (!codeMatches) {
      throw new UnauthorizedException("Codigo de recuperacao invalido.");
    }

    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { completedAt: new Date() },
    });

    await this.usersService.updateLastLogin(challenge.user.id);
    this.logger.log(
      `mfa_email_bypass_success userId=${challenge.user.id} challengeId=${challenge.id}`,
    );

    return this.issueTokens({
      userId: challenge.user.id,
      email: challenge.user.email,
      role: challenge.user.role,
      user: challenge.user,
      sessionContext: this.extractSessionContext(request),
    });
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

    // Varias tentativas: se outra requisicao rotacionou entre a leitura e a escrita (abas
    // abrindo juntas), na releitura o token apresentado ja esta entre os aposentados
    // recentes. Uma tentativa por requisicao concorrente no pior caso.
    for (let attempt = 0; attempt < REFRESH_ROTATION_MAX_ATTEMPTS; attempt += 1) {
      const session = await this.prisma.authSession.findFirst({
        where: {
          id: payload.sessionId,
          userId: payload.sub,
        },
      });

      this.assertSessionIsUsable(session);

      const recent = this.recentRetiredRefreshTokens(session.recentRefreshTokenHashes);
      let accepted = await this.refreshTokenMatches(
        refreshToken,
        session.refreshTokenHash,
      );

      for (const entry of recent) {
        if (accepted) {
          break;
        }
        accepted = await this.refreshTokenMatches(refreshToken, entry.hash);
      }

      if (!accepted) {
        await this.revokeSession(session.id, "refresh_token_reuse_detected");
        throw new UnauthorizedException("Refresh token invalido.");
      }

      const user = await this.usersService.findById(payload.sub);

      try {
        return await this.issueTokens({
          userId: user.id,
          email: user.email,
          role: user.role,
          user,
          sessionContext: this.extractSessionContext(request),
          existingSessionId: session.id,
          rotation: {
            expectedRefreshTokenHash: session.refreshTokenHash,
            retired: [
              ...recent,
              { hash: session.refreshTokenHash, retiredAt: Date.now() },
            ].slice(-REFRESH_RETIRED_KEEP),
          },
        });
      } catch (error) {
        if (!(error instanceof RefreshRotationConflictError)) {
          throw error;
        }
      }
    }

    throw new UnauthorizedException("Refresh token invalido.");
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

  /**
   * Resposta identica exista o email ou nao (nao vaza quais emails tem
   * conta). O trabalho de criar o desafio e enviar acontece so quando existe.
   */
  async forgotPassword(dto: ForgotPasswordDto, request?: RequestWithContext) {
    const genericResponse = {
      success: true,
      message:
        "Se existir uma conta com este email, enviamos um link para redefinir a senha.",
    };
    const user = await this.usersService.findByEmail(
      dto.email.toLowerCase().trim(),
    );

    if (!user) {
      return genericResponse;
    }

    const ttlMinutes = this.configService.get<number>(
      "auth.passwordResetTtlMinutes",
      60,
    );
    const link = await this.createLinkChallenge(
      user.id,
      AuthChallengeType.PASSWORD_RESET,
      ttlMinutes * 60 * 1000,
      this.extractSessionContext(request),
    );

    void this.mailService
      .sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetUrl: this.buildFrontendLink("/auth/reset-password", link),
        expiresInMinutes: ttlMinutes,
      })
      .catch((error) => {
        this.logger.warn(
          `password_reset_email_failed userId=${user.id} reason=${this.getErrorMessage(error)}`,
        );
      });

    return genericResponse;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.consumeLinkChallenge(
      dto.id,
      dto.token,
      AuthChallengeType.PASSWORD_RESET,
    );

    await this.usersService.updatePassword(
      userId,
      await bcrypt.hash(dto.password, 10),
    );
    // Quem redefine a senha pelo link provou que controla a caixa de email.
    await this.usersService.markEmailVerified(userId);
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "password_reset" },
    });

    const user = await this.usersService.findById(userId);
    void this.mailService
      .sendPasswordChangedEmail({ email: user.email, name: user.name })
      .catch((error) => {
        this.logger.warn(
          `password_changed_email_failed userId=${userId} reason=${this.getErrorMessage(error)}`,
        );
      });

    this.logger.log(`password_reset_success userId=${userId}`);
    return { success: true };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const userId = await this.consumeLinkChallenge(
      dto.id,
      dto.token,
      AuthChallengeType.EMAIL_VERIFICATION,
    );

    await this.usersService.markEmailVerified(userId);
    this.logger.log(`email_verified userId=${userId}`);
    return { success: true };
  }

  async resendEmailVerification(userId: string, request?: RequestWithContext) {
    const { alreadyVerified } = await this.dispatchEmailVerification(
      userId,
      request,
    );

    return { success: true, alreadyVerified };
  }

  /**
   * Gera um link novo (invalida o anterior) e envia o email de confirmacao.
   * Devolve se o envio foi pulado pelo provedor (Resend desligado), coisa que
   * o endpoint publico nao expoe mas a rotina de contas antigas precisa saber.
   */
  async dispatchEmailVerification(userId: string, request?: RequestWithContext) {
    const user = await this.usersService.findById(userId);

    if (user.emailVerifiedAt) {
      return { alreadyVerified: true, skipped: false };
    }

    const verifyUrl = await this.issueEmailVerificationLink(userId, request);
    const dispatch = await this.mailService.sendEmailVerificationEmail({
      email: user.email,
      name: user.name,
      verifyUrl,
      expiresInHours: this.configService.get<number>(
        "auth.emailVerificationTtlHours",
        48,
      ),
    });

    return { alreadyVerified: false, skipped: Boolean(dispatch?.skipped) };
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId);
    return this.usersService.sanitizeUser(user);
  }

  private async issueEmailVerificationLink(
    userId: string,
    request?: RequestWithContext,
  ) {
    const ttlHours = this.configService.get<number>(
      "auth.emailVerificationTtlHours",
      48,
    );
    const link = await this.createLinkChallenge(
      userId,
      AuthChallengeType.EMAIL_VERIFICATION,
      ttlHours * 60 * 60 * 1000,
      this.extractSessionContext(request),
    );

    return this.buildFrontendLink("/auth/verify-email", link);
  }

  private buildFrontendLink(
    path: string,
    link: { challengeId: string; secret: string },
  ) {
    const frontendUrl =
      this.configService.get<string>("app.frontendUrl") ??
      "http://localhost:4200";

    return `${frontendUrl}${path}?id=${link.challengeId}&token=${encodeURIComponent(link.secret)}`;
  }

  /**
   * Desafio de link por email (reset de senha, confirmacao de email). O
   * segredo tem 256 bits de entropia, entao basta um sha256 no banco (bcrypt
   * nao agrega e trunca em 72 bytes). So um desafio pendente por
   * usuario/tipo: pedir de novo invalida o link anterior.
   */
  private async createLinkChallenge(
    userId: string,
    type: AuthChallengeType,
    ttlMs: number,
    sessionContext: SessionContext,
  ) {
    const secret = randomBytes(32).toString("base64url");

    await this.prisma.authChallenge.deleteMany({
      where: { userId, type, completedAt: null },
    });
    const challenge = await this.prisma.authChallenge.create({
      data: {
        userId,
        type,
        token: this.hashLinkSecret(secret),
        expiresAt: new Date(Date.now() + ttlMs),
        ipAddress: sessionContext.ipAddress,
        userAgent: sessionContext.userAgent,
      },
    });

    return { challengeId: challenge.id, secret };
  }

  /** Valida e consome (uso unico) um desafio de link; devolve o userId. */
  private async consumeLinkChallenge(
    challengeId: string,
    secret: string,
    type: AuthChallengeType,
  ) {
    const invalid = new BadRequestException("Link invalido ou expirado.");
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { id: challengeId },
    });

    if (
      !challenge ||
      challenge.type !== type ||
      challenge.completedAt ||
      challenge.expiresAt <= new Date() ||
      !challenge.token
    ) {
      throw invalid;
    }

    const expected = Buffer.from(challenge.token);
    const received = Buffer.from(this.hashLinkSecret(secret));

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw invalid;
    }

    // updateMany com completedAt:null evita que dois cliques simultaneos
    // consumam o mesmo link.
    const consumed = await this.prisma.authChallenge.updateMany({
      where: { id: challenge.id, completedAt: null },
      data: { completedAt: new Date() },
    });

    if (consumed.count === 0) {
      throw invalid;
    }

    return challenge.userId;
  }

  /**
   * Compara o refresh token com o hash guardado. Sessoes antigas guardam bcrypt (que so
   * le os 72 primeiros bytes do JWT, entao nao distingue tokens do mesmo usuario): valem
   * ate a proxima rotacao, que regrava o hash em sha256.
   */
  private async refreshTokenMatches(
    token: string,
    stored: string | null | undefined,
  ): Promise<boolean> {
    if (!stored) {
      return false;
    }

    if (stored.startsWith("$2")) {
      return bcrypt.compare(token, stored);
    }

    const expected = Buffer.from(stored);
    const received = Buffer.from(this.hashLinkSecret(token));

    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  /** Tokens aposentados que ainda estao dentro da janela de tolerancia. */
  private recentRetiredRefreshTokens(value: unknown): RetiredRefreshToken[] {
    const graceSeconds =
      this.configService.get<number>("auth.refreshReuseGraceSeconds") ?? 30;
    const limit = Date.now() - graceSeconds * 1000;

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is RetiredRefreshToken =>
        !!item &&
        typeof item === "object" &&
        typeof (item as RetiredRefreshToken).hash === "string" &&
        typeof (item as RetiredRefreshToken).retiredAt === "number" &&
        (item as RetiredRefreshToken).retiredAt >= limit,
    );
  }

  private hashLinkSecret(secret: string) {
    return createHash("sha256").update(secret).digest("hex");
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

    const totpStep = secret ? this.mfaService.matchTotpStep(secret, code) : null;

    if (totpStep !== null) {
      // Cada passo de 30s so vale uma vez (RFC 6238 §5.2). O UPDATE condicional e
      // atomico: duas requisicoes com o mesmo codigo nao passam as duas.
      const claimed = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ mfaLastTotpStep: null }, { mfaLastTotpStep: { lt: totpStep } }],
        },
        data: { mfaLastTotpStep: totpStep, mfaLastVerifiedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new UnauthorizedException(
          "Esse codigo ja foi usado. Aguarde o proximo codigo do autenticador.",
        );
      }

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
    // request.ip ja respeita o "trust proxy" do Express; o 1o item do X-Forwarded-For
    // vem do proprio cliente e pode ser forjado.
    const rawIp = request?.ip?.trim() || null;
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
    /** Rotacao de refresh token: a troca so acontece se o hash vigente ainda for o lido (atomico). */
    rotation?: { expectedRefreshTokenHash: string; retired: RetiredRefreshToken[] };
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
        // O tipo do @nestjs/jwt 11 exige "number | StringValue" (ex.: "15m"); o valor vem da env.
        expiresIn: accessExpiresIn as JwtSignOptions["expiresIn"],
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as JwtSignOptions["expiresIn"],
        // Sem isso, dois refresh no mesmo segundo geram o MESMO token (payload e iat
        // iguais) e a rotacao deixa de distinguir o novo do antigo.
        jwtid: randomUUID(),
      }),
    ]);

    const refreshTokenHash = this.hashLinkSecret(refreshToken);
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
          ...(input.rotation
            ? { refreshTokenHash: input.rotation.expectedRefreshTokenHash }
            : {}),
        },
        data: {
          refreshTokenHash,
          recentRefreshTokenHashes: input.rotation?.retired ?? [],
          expiresAt,
          ipAddress: input.sessionContext.ipAddress,
          userAgent: input.sessionContext.userAgent,
          lastUsedAt: now,
          revokeReason: null,
        },
      });

      if (result.count === 0) {
        const stillActive = input.rotation
          ? await this.prisma.authSession.findFirst({
              where: { id: input.existingSessionId, userId: input.userId, revokedAt: null },
              select: { id: true },
            })
          : null;

        if (stillActive) {
          throw new RefreshRotationConflictError();
        }

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
