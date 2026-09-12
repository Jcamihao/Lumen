import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { NotificationType, ReminderStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { CacheQueueService } from "../cache-queue/cache-queue.service";
import { ForecastsService } from "../forecasts/forecasts.service";
import { InsightsService } from "../insights/insights.service";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  FORECASTS_QUEUE,
  INSIGHTS_QUEUE,
  LifeEngineService,
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
    );
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
