import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import { CacheQueueService } from "../cache-queue/cache-queue.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { EmailPreferencesService } from "../email-preferences/email-preferences.service";
import { ForecastsService } from "../forecasts/forecasts.service";
import { InsightsService } from "../insights/insights.service";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { RecurringMaterializerService } from "../recurring-transactions/recurring-materializer.service";
import { InstallmentMaterializerService } from "../installments/installment-materializer.service";
import { BillReminderService } from "./bill-reminder.service";
import {
  FORECASTS_QUEUE,
  INSIGHTS_QUEUE,
  LifeEngineService,
  PULSE_SCAN_QUEUE,
  REMINDERS_QUEUE,
} from "./life-engine.service";
import { bootstrapPendingReminders } from "./workers/reminder-bootstrap";
import { ReminderDispatchProcessor } from "./workers/reminder-dispatch.processor";
import { InsightsRefreshProcessor } from "./workers/insights-refresh.processor";
import { InsightEscalation } from "./workers/insight-escalation";
import { ForecastRefreshProcessor } from "./workers/forecast-refresh.processor";
import { PulseScanProcessor } from "./workers/pulse-scan.processor";
import { PulseUserProcessor } from "./workers/pulse-user.processor";
import { GoalRecurringContributions } from "./workers/goal-recurring-contributions";
import { WeeklyDigest } from "./workers/weekly-digest";

@Injectable()
export class LifeWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LifeWorkersService.name);
  private readonly workers: Worker[] = [];
  private readonly reminders: ReminderDispatchProcessor;
  private readonly insights: InsightsRefreshProcessor;
  private readonly forecasts: ForecastRefreshProcessor;
  private readonly pulseScan: PulseScanProcessor;

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
    private readonly emailPreferencesService: EmailPreferencesService,
    private readonly recurringMaterializer: RecurringMaterializerService,
    private readonly installmentMaterializer: InstallmentMaterializerService,
    private readonly billReminderService: BillReminderService,
  ) {
    const escalation = new InsightEscalation(prisma, configService, mailService, emailPreferencesService);
    const goalContributions = new GoalRecurringContributions(prisma, notificationsService);
    const weeklyDigest = new WeeklyDigest(prisma, dashboardService, mailService, emailPreferencesService);
    const pulseUser = new PulseUserProcessor(goalContributions, lifeEngineService, forecastsService, billReminderService, weeklyDigest);

    this.reminders = new ReminderDispatchProcessor(prisma, notificationsService, mailService, emailPreferencesService);
    this.insights = new InsightsRefreshProcessor(insightsService, notificationsService, escalation);
    this.forecasts = new ForecastRefreshProcessor(forecastsService, notificationsService);
    this.pulseScan = new PulseScanProcessor(prisma, configService, lifeEngineService, recurringMaterializer, installmentMaterializer, pulseUser);
  }

  async onModuleInit() {
    const connection = this.cacheQueueService.getQueueConnection();

    if (!this.cacheQueueService.isReady() || !connection) {
      this.logger.warn("Workers desativados porque o Redis nao esta disponivel.");
      return;
    }

    await bootstrapPendingReminders(this.prisma, this.lifeEngineService);
    await this.lifeEngineService.schedulePulseScan();

    this.workers.push(
      new Worker(REMINDERS_QUEUE, (job) => this.reminders.dispatch(job), { connection }),
      new Worker(INSIGHTS_QUEUE, (job) => this.insights.refresh(job), { connection }),
      new Worker(FORECASTS_QUEUE, (job) => this.forecasts.refresh(job), { connection }),
      new Worker(PULSE_SCAN_QUEUE, () => this.pulseScan.run(), { connection }),
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
