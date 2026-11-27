import { ConfigService } from "@nestjs/config";
import { InsightSeverity } from "@prisma/client";
import { canSendAutomatedEmail } from "../../email-preferences/email-categories";
import { EmailPreferencesService } from "../../email-preferences/email-preferences.service";
import { MailService } from "../../mail/mail.service";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage } from "./error-message";
import { MS_PER_DAY } from "./local-time";
import { workerLogger } from "./worker-logger";

const DEFAULT_ESCALATION_DAYS = 3;

type EscalationTarget = { email: string; name: string };
type StaleInsight = { id: string; message: string };

/**
 * Insight CRITICAL notificado (in-app) ha dias sem resolucao ganha uma
 * escalada por email, uma unica vez (escalatedAt marca isso). So escala o
 * que ainda esta presente na geracao mais recente.
 */
export class InsightEscalation {
  private readonly logger = workerLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly emailPreferencesService: EmailPreferencesService,
  ) {}

  async escalate(userId: string) {
    const stale = await this.findStaleInsights(userId);
    if (stale.length === 0) return;

    const user = await this.findEscalationUser(userId);
    if (!user) return;

    // Sem elegibilidade o email nao sai, mas o insight ainda e marcado como
    // escalado abaixo — senao ficaria "pendente de escalar" para sempre.
    if (canSendAutomatedEmail(user, "insight_alerts")) {
      await this.sendEmails(userId, user, stale);
    }

    await this.markEscalated(stale);
    this.logger.log(`insight_escalation userId=${userId} count=${stale.length}`);
  }

  private findEscalationUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, emailVerifiedAt: true, emailInsightAlerts: true },
    });
  }

  private markEscalated(stale: StaleInsight[]) {
    return this.prisma.insight.updateMany({
      where: { id: { in: stale.map((insight) => insight.id) } },
      data: { escalatedAt: new Date() },
    });
  }

  private findStaleInsights(userId: string) {
    const days = this.configService.get<number>("app.selahEscalationDays", DEFAULT_ESCALATION_DAYS);
    const threshold = new Date(Date.now() - days * MS_PER_DAY);

    return this.prisma.insight.findMany({
      where: {
        userId,
        severity: InsightSeverity.CRITICAL,
        notifiedAt: { not: null, lte: threshold },
        escalatedAt: null,
      },
    });
  }

  private async sendEmails(userId: string, user: EscalationTarget, stale: StaleInsight[]) {
    for (const insight of stale) {
      try {
        await this.mailService.sendInsightEscalationEmail({
          email: user.email,
          name: user.name,
          message: insight.message,
          unsubscribe: this.emailPreferencesService.buildUnsubscribeLinks(userId, "insight_alerts"),
        });
      } catch (error) {
        this.logger.warn(
          `insight_escalation_email_failed insightId=${insight.id} reason=${getErrorMessage(error)}`,
        );
      }
    }
  }
}
