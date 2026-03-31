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
  ) {}

  async onModuleInit() {
    const connection = this.cacheQueueService.getQueueConnection();

    if (!this.cacheQueueService.isReady() || !connection) {
      this.logger.warn(
        "Workers desativados porque o Redis nao esta disponivel.",
      );
      return;
    }

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
          const insights = await this.insightsService.refreshForUser(userId);
          const criticalInsight = insights.find(
            (insight) => insight.severity === "CRITICAL",
          );

          if (criticalInsight) {
            await this.notificationsService.createNotification(
              userId,
              NotificationType.INSIGHT,
              "Alerta importante do LUMEN",
              criticalInsight.message,
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

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
