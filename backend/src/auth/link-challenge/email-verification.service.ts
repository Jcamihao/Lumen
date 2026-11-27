import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthChallengeType } from "@prisma/client";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { MailService } from "../../mail/mail.service";
import { UsersService } from "../../users/users.service";
import { VerifyEmailDto } from "../dto/verify-email.dto";
import { extractSessionContext } from "../session/session-context";
import { LinkChallengeService } from "./link-challenge.service";

const DEFAULT_TTL_HOURS = 48;

/** Confirmacao de email por link: gerar o link, enviar, reenviar e validar. */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly users: UsersService,
    private readonly links: LinkChallengeService,
  ) {}

  async verifyEmail(dto: VerifyEmailDto) {
    const userId = await this.links.consume(dto.id, dto.token, AuthChallengeType.EMAIL_VERIFICATION);
    await this.users.markEmailVerified(userId);
    this.logger.log(`email_verified userId=${userId}`);
    return { success: true };
  }

  async resendEmailVerification(userId: string, request?: RequestWithContext) {
    const { alreadyVerified } = await this.dispatchEmailVerification(userId, request);
    return { success: true, alreadyVerified };
  }

  /**
   * Gera um link novo (invalida o anterior) e envia o email de confirmacao.
   * Devolve se o envio foi pulado pelo provedor (Resend desligado), coisa que
   * o endpoint publico nao expoe mas a rotina de contas antigas precisa saber.
   */
  async dispatchEmailVerification(userId: string, request?: RequestWithContext) {
    const user = await this.users.findById(userId);
    if (user.emailVerifiedAt) return { alreadyVerified: true, skipped: false };

    const verifyUrl = await this.issueLink(userId, request);
    const dispatch = await this.mail.sendEmailVerificationEmail({
      email: user.email,
      name: user.name,
      verifyUrl,
      expiresInHours: this.ttlHours(),
    });
    return { alreadyVerified: false, skipped: Boolean(dispatch?.skipped) };
  }

  async issueLink(userId: string, request?: RequestWithContext): Promise<string> {
    const link = await this.links.create(
      userId,
      AuthChallengeType.EMAIL_VERIFICATION,
      this.ttlHours() * 60 * 60 * 1000,
      extractSessionContext(request),
    );
    return this.links.buildFrontendLink("/auth/verify-email", link);
  }

  private ttlHours(): number {
    return this.config.get<number>("auth.emailVerificationTtlHours", DEFAULT_TTL_HOURS);
  }
}
