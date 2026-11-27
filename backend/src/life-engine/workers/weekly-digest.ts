import { canSendAutomatedEmail } from "../../email-preferences/email-categories";
import { EmailPreferencesService } from "../../email-preferences/email-preferences.service";
import { DashboardService } from "../../dashboard/dashboard.service";
import { MailService } from "../../mail/mail.service";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage } from "./error-message";
import { workerLogger } from "./worker-logger";

type DigestSummary = {
  user: { name: string; preferredCurrency: string };
  tasks: { overdueCount: number };
  finances: { balance: number; monthlyExpenses: number; monthlyIncome: number };
  goals: { title: string; currentAmount: number; targetAmount: number | null }[];
};

/**
 * Resumo semanal — cadencia propria (segunda-feira local, uma vez a cada
 * >=6 dias), independente do pulso diario. Reusa DashboardService.getSummary
 * em vez de reimplementar as agregacoes de tarefas/financas/metas.
 */
export class WeeklyDigest {
  private readonly logger = workerLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
    private readonly mailService: MailService,
    private readonly emailPreferencesService: EmailPreferencesService,
  ) {}

  async send(userId: string): Promise<boolean> {
    try {
      return await this.sendIfEligible(userId);
    } catch (error) {
      this.logger.warn(`weekly_digest_failed userId=${userId} reason=${getErrorMessage(error)}`);
      return false;
    }
  }

  private async sendIfEligible(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, emailWeeklyDigest: true },
    });

    if (!user) return false;

    // Fora da elegibilidade (email nao confirmado ou categoria desligada)
    // ainda avanca lastWeeklyDigestAt, senao o pulso horario reavaliaria
    // esse usuario a cada rodada de segunda-feira.
    if (!canSendAutomatedEmail(user, "weekly_digest")) {
      await this.markDigestSent(userId);
      return false;
    }

    await this.deliver(userId, user.email);
    await this.markDigestSent(userId);
    return true;
  }

  private async deliver(userId: string, email: string) {
    const summary = (await this.dashboardService.getSummary(userId)) as DigestSummary;

    await this.mailService.sendWeeklyDigestEmail({
      email,
      name: summary.user.name,
      preferredCurrency: summary.user.preferredCurrency,
      overdueTasksCount: summary.tasks.overdueCount,
      balance: summary.finances.balance,
      monthlyExpenses: summary.finances.monthlyExpenses,
      monthlyIncome: summary.finances.monthlyIncome,
      goals: summary.goals,
      unsubscribe: this.emailPreferencesService.buildUnsubscribeLinks(userId, "weekly_digest"),
    });
  }

  private markDigestSent(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastWeeklyDigestAt: new Date() },
    });
  }
}
