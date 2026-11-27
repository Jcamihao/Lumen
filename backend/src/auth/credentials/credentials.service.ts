import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { MailService } from "../../mail/mail.service";
import { UsersService } from "../../users/users.service";
import { LoginDto } from "../dto/login.dto";
import { RegisterDto } from "../dto/register.dto";
import { errorMessage } from "../error-message";
import { EmailVerificationService } from "../link-challenge/email-verification.service";
import { isMfaEnabled, MfaGate } from "../mfa/mfa-gate";
import { MfaLoginService } from "../mfa/mfa-login.service";
import { extractSessionContext } from "../session/session-context";
import { AuthTokensResponse } from "../session/session.types";
import { TokenIssuerService } from "../session/token-issuer.service";

type LoginMfaChallengeResponse = {
  requiresMfa: true;
  challengeId: string;
  challengeExpiresAt: string;
  availableMethods: Array<"totp" | "recovery_code">;
};

// Login com email inexistente tambem gasta um bcrypt.compare (mesmo custo dos hashes
// reais), senao o tempo de resposta revela quais emails tem conta.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("lumen-timing-equalizer", 10);

/** Cadastro e login por email e senha. */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly tokens: TokenIssuerService,
    private readonly mfaGate: MfaGate,
    private readonly mfaLogin: MfaLoginService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async register(dto: RegisterDto, request?: RequestWithContext) {
    if (!dto.privacyNoticeAccepted) {
      throw new BadRequestException("E necessario aceitar o aviso de privacidade para criar a conta.");
    }
    const normalizedEmail = dto.email.toLowerCase().trim();
    if (await this.users.findByEmail(normalizedEmail)) {
      throw new BadRequestException("Ja existe uma conta com este email.");
    }

    const user = await this.users.createUser({
      name: dto.name,
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(dto.password, 10),
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
    this.sendWelcomeEmail(user, request);
    return this.tokens.issueForUser(user, request);
  }

  private sendWelcomeEmail(user: { id: string; email: string; name: string }, request?: RequestWithContext) {
    void this.emailVerification
      .issueLink(user.id, request)
      .then((verifyUrl) => this.mail.sendWelcomeEmail({ email: user.email, name: user.name, verifyUrl }))
      .catch((error) => {
        this.logger.warn(`welcome_email_failed userId=${user.id} email=${user.email} reason=${errorMessage(error)}`);
      });
  }

  async login(dto: LoginDto, request?: RequestWithContext): Promise<AuthTokensResponse | LoginMfaChallengeResponse> {
    const user = await this.users.findByEmail(dto.email.toLowerCase().trim());
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException("Credenciais invalidas.");
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Credenciais invalidas.");
    }
    if (this.mfaGate.isFeatureEnabled() && isMfaEnabled(user)) {
      const challenge = await this.mfaLogin.createChallenge(user.id, extractSessionContext(request));
      return {
        requiresMfa: true,
        challengeId: challenge.id,
        challengeExpiresAt: challenge.expiresAt.toISOString(),
        availableMethods: ["totp", "recovery_code"],
      };
    }

    await this.users.updateLastLogin(user.id);
    this.logger.log(`login_success userId=${user.id} email=${user.email}`);
    return this.tokens.issueForUser(user, request);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    return this.users.sanitizeUser(user);
  }
}
