import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BillDueEmailInput,
  EmailContext,
  EmailVerificationInput,
  InsightEscalationEmailInput,
  MailDispatchResult,
  MfaBypassEmailInput,
  PasswordChangedEmailInput,
  PasswordResetEmailInput,
  ReminderEmailInput,
  SendEmailOptions,
  WeeklyDigestEmailInput,
  WelcomeEmailInput,
} from "./mail.types";
import { ResendTransport } from "./resend/resend.transport";
import { buildBillDueEmail } from "./templates/bill-due.email";
import { buildEmailVerificationEmail } from "./templates/email-verification.email";
import { buildInsightEscalationEmail } from "./templates/insight-escalation.email";
import { buildMfaBypassEmail } from "./templates/mfa-bypass.email";
import { buildPasswordChangedEmail } from "./templates/password-changed.email";
import { buildPasswordResetEmail } from "./templates/password-reset.email";
import { buildReminderEmail } from "./templates/reminder.email";
import { buildWeeklyDigestEmail } from "./templates/weekly-digest.email";
import { buildWelcomeEmail } from "./templates/welcome.email";

export type { UnsubscribeLinks } from "./mail.types";

/**
 * Emails do LUMEN: monta o conteudo de cada tipo e entrega ao transporte (Resend).
 * Os metodos sao async para que qualquer falha na montagem chegue como promessa rejeitada.
 */
@Injectable()
export class MailService {
  constructor(
    private readonly config: ConfigService,
    private readonly transport: ResendTransport,
  ) {}

  async sendWelcomeEmail(input: WelcomeEmailInput) {
    return this.sendEmail(buildWelcomeEmail(input, this.context()));
  }

  async sendEmailVerificationEmail(input: EmailVerificationInput) {
    return this.sendEmail(buildEmailVerificationEmail(input, this.context()));
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput) {
    return this.sendEmail(buildPasswordResetEmail(input, this.context()));
  }

  async sendPasswordChangedEmail(input: PasswordChangedEmailInput) {
    return this.sendEmail(buildPasswordChangedEmail(input, this.context()));
  }

  async sendReminderEmail(input: ReminderEmailInput) {
    return this.sendEmail(buildReminderEmail(input, this.context()));
  }

  /**
   * Dispara quando um insight CRITICAL fica notificado (in-app) sem resolucao por dias
   * seguidos. Canal diferente do in-app, uma unica vez por insight (escalatedAt no chamador).
   */
  async sendInsightEscalationEmail(input: InsightEscalationEmailInput) {
    return this.sendEmail(buildInsightEscalationEmail(input, this.context()));
  }

  async sendWeeklyDigestEmail(input: WeeklyDigestEmailInput) {
    return this.sendEmail(buildWeeklyDigestEmail(input, this.context()));
  }

  async sendBillDueEmail(input: BillDueEmailInput) {
    return this.sendEmail(buildBillDueEmail(input, this.context()));
  }

  async sendMfaBypassEmail(input: MfaBypassEmailInput) {
    return this.sendEmail(buildMfaBypassEmail(input, this.context()));
  }

  async sendEmail(options: SendEmailOptions): Promise<MailDispatchResult> {
    return this.transport.send(options);
  }

  private context(): EmailContext {
    return { frontendUrl: this.config.get<string>("app.frontendUrl") ?? "http://localhost:4200" };
  }
}
