import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { CacheQueueService } from '../cache-queue/cache-queue.service';
import { ForecastsService } from '../forecasts/forecasts.service';
import { InsightsService } from '../insights/insights.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthToDateUtc } from '../recurring-transactions/recurrence.util';
import { RecurringMaterializerService } from '../recurring-transactions/recurring-materializer.service';
import { InstallmentMaterializerService } from '../installments/installment-materializer.service';
import { findActiveGoals } from './queries/goals.query';
import { findUnreadNotifications } from './queries/notifications.query';
import { findOnboardingItems } from './queries/onboarding.query';
import { findUpcomingReminders } from './queries/reminders.query';
import { resolveAll } from './queries/resolve-all';
import { countOverdueTasks, findTodayTasks } from './queries/tasks.query';
import { findRecentTransactions, sumBalanceByType, sumMonthlyTransactions } from './queries/transactions.query';
import { findUserProfile, findUserTimezone } from './queries/user.query';
import { DashboardSummary } from './summary/dashboard-summary.type';
import { buildSummary } from './summary/build-summary';
import { SummarySources } from './summary/summary-sources.type';
import { DateRange, todayWindow } from './today-window';

const summaryCacheKey = (userId: string) => `dashboard:summary:${userId}`;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheQueueService: CacheQueueService,
    private readonly insightsService: InsightsService,
    private readonly forecastsService: ForecastsService,
    private readonly recurringMaterializer: RecurringMaterializerService,
    private readonly installmentMaterializer: InstallmentMaterializerService,
  ) {}

  async getSummary(userId: string): Promise<DashboardSummary> {
    await this.materializeDueEntries(userId);

    const cachedSummary = await this.cacheQueueService.getJson<DashboardSummary>(summaryCacheKey(userId));
    if (cachedSummary) {
      return cachedSummary;
    }

    const summary = buildSummary(await this.loadSources(userId));
    await this.cacheQueueService.setJson(summaryCacheKey(userId), summary);
    return summary;
  }

  /** Descarta o resumo em cache (ex.: apos uma conversa com o Selah, que nao passa pelo LifeEngine). */
  async invalidateSummary(userId: string) {
    await this.cacheQueueService.del(summaryCacheKey(userId));
  }

  // Conta fixa ou parcela que venceu desde a ultima leitura precisa entrar no
  // saldo, e o resumo em cache ja nasceu sem ela.
  private async materializeDueEntries(userId: string) {
    const recurringCreated = await this.recurringMaterializer.materializeDue(userId);
    const installmentsCreated = await this.installmentMaterializer.materializeDue(userId);
    if (recurringCreated > 0 || installmentsCreated > 0) {
      await this.cacheQueueService.del(summaryCacheKey(userId));
    }
  }

  private async loadSources(userId: string): Promise<SummarySources> {
    const now = new Date();
    const { timezone } = await findUserTimezone(this.prisma, userId);
    return this.queryAll(userId, now, monthToDateUtc(now, timezone));
  }

  private queryAll(userId: string, now: Date, month: DateRange): Promise<SummarySources> {
    const today = todayWindow(now);

    return resolveAll<SummarySources>({
      user: findUserProfile(this.prisma, userId),
      todayTasks: findTodayTasks(this.prisma, userId, today),
      overdueTasksCount: countOverdueTasks(this.prisma, userId, today.start),
      balanceRows: sumBalanceByType(this.prisma, userId),
      recentTransactions: findRecentTransactions(this.prisma, userId),
      monthlyExpenses: sumMonthlyTransactions(this.prisma, userId, TransactionType.EXPENSE, month),
      monthlyIncome: sumMonthlyTransactions(this.prisma, userId, TransactionType.INCOME, month),
      goals: findActiveGoals(this.prisma, userId),
      reminders: findUpcomingReminders(this.prisma, userId, now),
      notifications: findUnreadNotifications(this.prisma, userId),
      insights: this.insightsService.list(userId),
      forecast: this.forecastsService.getCurrent(userId),
      onboarding: findOnboardingItems(this.prisma, userId),
    });
  }
}
