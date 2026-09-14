import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InsightSeverity, NotificationType, ReminderStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { CacheQueueService } from "../cache-queue/cache-queue.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { ForecastsService } from "../forecasts/forecasts.service";
import { InsightsService } from "../insights/insights.service";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  FORECASTS_QUEUE,
  INSIGHTS_QUEUE,
  LifeEngineService,
  PULSE_SCAN_QUEUE,
  REMINDERS_QUEUE,
} from "./life-engine.service";

@Injectable()
export class LifeWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LifeWorkersService.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly cacheQueueService: CacheQueueService,
    private readonly prisma: PrismaService,
    private readonly insightsService: InsightsService,
    private readonly forecastsService: ForecastsService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly configService: ConfigService,
    private readonly dashboardService: DashboardService,
  ) {}

  async onModuleInit() {
    const connection = this.cacheQueueService.getQueueConnection();

    if (!this.cacheQueueService.isReady() || !connection) {
      this.logger.warn(
        "Workers desativados porque o Redis nao esta disponivel.",
      );
      return;
    }

    await this.bootstrapPendingReminders();
    await this.lifeEngineService.schedulePulseScan();

    this.workers.push(
      new Worker(
        REMINDERS_QUEUE,
        async (job) => {
          const reminderId = String(job.data.reminderId);
          const reminder = await this.prisma.reminder.findUnique({
            where: { id: reminderId },
            include: {
              user: {
                select: {
                  email: true,
                  name: true,
                  timezone: true,
                },
              },
              task: true,
              transaction: true,
              goal: true,
            },
          });

          if (!reminder || reminder.status !== ReminderStatus.SCHEDULED) {
            return;
          }

          await this.prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: ReminderStatus.SENT,
              sentAt: new Date(),
            },
          });

          const relatedTitle =
            reminder.task?.title ??
            reminder.transaction?.description ??
            reminder.goal?.title;
          await this.notificationsService.createNotification(
            reminder.userId,
            NotificationType.REMINDER,
            reminder.title,
            relatedTitle
              ? `Lembrete disparado: ${reminder.title}. Contexto: ${relatedTitle}.`
              : `Lembrete disparado: ${reminder.title}.`,
          );

          try {
            await this.mailService.sendReminderEmail({
              email: reminder.user.email,
              name: reminder.user.name,
              title: reminder.title,
              contextTitle: relatedTitle,
              remindAt: reminder.remindAt,
              timezone: reminder.user.timezone,
            });
          } catch (error) {
            this.logger.warn(
              `reminder_email_failed reminderId=${reminder.id} userId=${reminder.userId} reason=${this.getErrorMessage(error)}`,
            );
          }
        },
        { connection },
      ),
      new Worker(
        INSIGHTS_QUEUE,
        async (job) => {
          const userId = String(job.data.userId);

          await this.insightsService.refreshForUser(userId);

          // So notifica o que ainda nao foi avisado. Antes, o refresh recriava
          // todos os insights a cada ciclo, entao o mesmo alerta critico virava
          // notificacao nova toda vez que a fila rodava.
          const pending =
            await this.insightsService.takePendingNotifications(userId);

          for (const insight of pending) {
            await this.notificationsService.createNotification(
              userId,
              NotificationType.INSIGHT,
              this.insightNotificationTitle(insight.metadata),
              insight.message,
            );
          }

          await this.escalateStaleInsights(userId);
        },
        { connection },
      ),
      new Worker(
        FORECASTS_QUEUE,
        async (job) => {
          const userId = String(job.data.userId);
          const forecast =
            await this.forecastsService.recalculateForUser(userId);

          if (forecast.riskLevel === "HIGH") {
            await this.notificationsService.createNotification(
              userId,
              NotificationType.FORECAST,
              "Risco financeiro elevado",
              "Sua previsao financeira indica risco alto para os proximos 30 dias.",
            );
          }
        },
        { connection },
      ),
      new Worker(
        PULSE_SCAN_QUEUE,
        async () => {
          await this.runPulseScan();
        },
        { connection },
      ),
    );
  }

  /**
   * Roda a cada tick do PULSE_SCAN_QUEUE (de hora em hora). Recalcula
   * insights so de quem esta, agora, na hora local configurada — reusa o
   * mesmo touchUserData() que ja dispara reativamente apos uma mutacao, so
   * que aqui o gatilho e o relogio, nao uma acao do usuario.
   */
  private async runPulseScan() {
    const targetHour = this.configService.get<number>(
      "app.selahPulseHourLocal",
      7,
    );

    const users = await this.prisma.user.findMany({
      select: { id: true, timezone: true, lastWeeklyDigestAt: true },
    });

    let touched = 0;
    let digests = 0;

    for (const user of users) {
      if (this.localHourFor(user.timezone) !== targetHour) {
        continue;
      }

      await this.lifeEngineService.touchUserData(user.id);
      touched += 1;

      if (this.isMondayLocal(user.timezone) && this.daysSince(user.lastWeeklyDigestAt) >= 6) {
        const sent = await this.sendWeeklyDigest(user.id);
        if (sent) digests += 1;
      }
    }

    if (touched > 0) {
      this.logger.log(
        `pulse_scan touched=${touched} digests=${digests} targetHour=${targetHour}`,
      );
    }
  }

  /**
   * Resumo semanal — cadencia propria (segunda-feira local, uma vez a cada
   * >=6 dias), independente do pulso diario. Reusa DashboardService.getSummary
   * em vez de reimplementar as agregacoes de tarefas/financas/metas.
   */
  private async sendWeeklyDigest(userId: string): Promise<boolean> {
    try {
      const summary = (await this.dashboardService.getSummary(userId)) as {
        user: { name: string; preferredCurrency: string };
        tasks: { overdueCount: number };
        finances: { balance: number; monthlyExpenses: number; monthlyIncome: number };
        goals: { title: string; currentAmount: number; targetAmount: number }[];
      };

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) return false;

      await this.mailService.sendWeeklyDigestEmail({
        email: user.email,
        name: summary.user.name,
        preferredCurrency: summary.user.preferredCurrency,
        overdueTasksCount: summary.tasks.overdueCount,
        balance: summary.finances.balance,
        monthlyExpenses: summary.finances.monthlyExpenses,
        monthlyIncome: summary.finances.monthlyIncome,
        goals: summary.goals,
      });

      await this.prisma.user.update({
        where: { id: userId },
        data: { lastWeeklyDigestAt: new Date() },
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `weekly_digest_failed userId=${userId} reason=${this.getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Insight CRITICAL notificado (in-app) ha dias sem resolucao ganha uma
   * escalada por email, uma unica vez (escalatedAt marca isso). So escala o
   * que ainda esta presente na geracao mais recente — refreshForUser acabou
   * de rodar na mesma chamada, entao o estado no banco ja e o atual.
   */
  private async escalateStaleInsights(userId: string) {
    const days = this.configService.get<number>("app.selahEscalationDays", 3);
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const stale = await this.prisma.insight.findMany({
      where: {
        userId,
        severity: InsightSeverity.CRITICAL,
        notifiedAt: { not: null, lte: threshold },
        escalatedAt: null,
      },
    });

    if (stale.length === 0) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user) return;

    for (const insight of stale) {
      try {
        await this.mailService.sendInsightEscalationEmail({
          email: user.email,
          name: user.name,
          message: insight.message,
        });
      } catch (error) {
        this.logger.warn(
          `insight_escalation_email_failed insightId=${insight.id} reason=${this.getErrorMessage(error)}`,
        );
      }
    }

    await this.prisma.insight.updateMany({
      where: { id: { in: stale.map((insight) => insight.id) } },
      data: { escalatedAt: new Date() },
    });

    this.logger.log(`insight_escalation userId=${userId} count=${stale.length}`);
  }

  private isMondayLocal(timezone: string): boolean {
    try {
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
      }).format(new Date());
      return weekday === "Mon";
    } catch {
      return false;
    }
  }

  private daysSince(date: Date | null): number {
    if (!date) return Infinity;
    return (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
  }

  private localHourFor(timezone: string): number {
    try {
      const hourText = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(new Date());

      return parseInt(hourText, 10) % 24;
    } catch {
      // Fuso horario invalido salvo no usuario: nunca bate a hora alvo, em
      // vez de derrubar o scan inteiro pra todo mundo.
      return -1;
    }
  }

  /** Usa a persona do insight como remetente do alerta, quando existir. */
  private insightNotificationTitle(metadata: unknown) {
    const persona = (metadata as { persona?: { name?: string } } | null)?.persona
      ?.name;

    return persona ? `${persona} encontrou algo` : "Alerta importante do LUMEN";
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }

  private async bootstrapPendingReminders() {
    try {
      const pending = await this.prisma.reminder.findMany({
        where: { status: ReminderStatus.SCHEDULED, remindAt: { gt: new Date() } },
        select: { id: true, remindAt: true },
      });

      for (const reminder of pending) {
        await this.lifeEngineService.scheduleReminder(reminder.id, reminder.remindAt);
      }

      if (pending.length > 0) {
        this.logger.log(`bootstrap_reminders count=${pending.length}`);
      }
    } catch (error) {
      this.logger.warn(
        `bootstrap_reminders_failed reason=${this.getErrorMessage(error)}`,
      );
    }
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
