import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthChallengeType } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { MailService } from "../../mail/mail.service";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { errorMessage } from "../error-message";
import { ForgotPasswordDto } from "../dto/forgot-password.dto";
import { ResetPasswordDto } from "../dto/reset-password.dto";
import { extractSessionContext } from "../session/session-context";
import { LinkChallengeService } from "./link-challenge.service";

const DEFAULT_TTL_MINUTES = 60;

/** Esqueci a senha: pedir o link por email e redefinir a senha com ele. */
@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly links: LinkChallengeService,
  ) {}

  /**
   * Resposta identica exista o email ou nao (nao vaza quais emails tem
   * conta). O trabalho de criar o desafio e enviar acontece so quando existe.
   */
  async forgotPassword(dto: ForgotPasswordDto, request?: RequestWithContext) {
    const genericResponse = {
      success: true,
      message: "Se existir uma conta com este email, enviamos um link para redefinir a senha.",
    };
    const user = await this.users.findByEmail(dto.email.toLowerCase().trim());
    if (!user) return genericResponse;

    const ttlMinutes = this.config.get<number>("auth.passwordResetTtlMinutes", DEFAULT_TTL_MINUTES);
    const link = await this.links.create(
      user.id,
      AuthChallengeType.PASSWORD_RESET,
      ttlMinutes * 60 * 1000,
      extractSessionContext(request),
    );
    void this.mail
      .sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetUrl: this.links.buildFrontendLink("/auth/reset-password", link),
        expiresInMinutes: ttlMinutes,
      })
      .catch((error) => {
        this.logger.warn(`password_reset_email_failed userId=${user.id} reason=${errorMessage(error)}`);
      });
    return genericResponse;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.links.consume(dto.id, dto.token, AuthChallengeType.PASSWORD_RESET);

    await this.users.updatePassword(userId, await bcrypt.hash(dto.password, 10));
    // Quem redefine a senha pelo link provou que controla a caixa de email.
    await this.users.markEmailVerified(userId);
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "password_reset" },
    });
    await this.notifyPasswordChanged(userId);

    this.logger.log(`password_reset_success userId=${userId}`);
    return { success: true };
  }

  private async notifyPasswordChanged(userId: string) {
    const user = await this.users.findById(userId);
    void this.mail.sendPasswordChangedEmail({ email: user.email, name: user.name }).catch((error) => {
      this.logger.warn(`password_changed_email_failed userId=${userId} reason=${errorMessage(error)}`);
    });
  }
}
