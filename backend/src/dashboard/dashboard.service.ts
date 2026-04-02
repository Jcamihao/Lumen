import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { CacheQueueService } from '../cache-queue/cache-queue.service';
import { ForecastsService } from '../forecasts/forecasts.service';
import { InsightsService } from '../insights/insights.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheQueueService: CacheQueueService,
    private readonly insightsService: InsightsService,
    private readonly forecastsService: ForecastsService,
  ) {}

  async getSummary(userId: string) {
    const cacheKey = `dashboard:summary:${userId}`;
    const cachedSummary = await this.cacheQueueService.getJson(cacheKey);

    if (cachedSummary) {
      return cachedSummary;
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      user,
      tasksTodayCount,
      tasksToday,
      overdueTasksCount,
      balanceAggregate,
      recentTransactions,
      monthlyExpenseAggregate,
      monthlyIncomeAggregate,
      goals,
      reminders,
      notifications,
      insights,
      forecast,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          preferredCurrency: true,
          monthlyIncome: true,
        },
      }),
      this.prisma.task.count({
        where: {
          userId,
          dueDate: {
            gte: todayStart,
            lte: todayEnd,
          },
          status: {
            in: ['PENDING', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.task.findMany({
        where: {
          userId,
          dueDate: {
            gte: todayStart,
            lte: todayEnd,
          },
          status: {
            in: ['PENDING', 'IN_PROGRESS'],
          },
        },
        include: {
          category: true,
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
        take: 5,
      }),
      this.prisma.task.count({
        where: {
          userId,
          dueDate: {
            lt: todayStart,
          },
          status: {
            in: ['PENDING', 'IN_PROGRESS'],
          },
        },
      }),
      this.prisma.transaction.groupBy({
        where: { userId },
        by: ['type'],
        _sum: {
          amount: true,
        },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        select: {
          id: true,
          description: true,
          type: true,
          amount: true,
          date: true,
          category: true,
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 6,
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId,
          type: 'EXPENSE',
          date: {
            gte: monthStart,
            lte: now,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId,
          type: 'INCOME',
          date: {
            gte: monthStart,
            lte: now,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.goal.findMany({
        where: {
          userId,
          status: {
            in: ['ACTIVE', 'PLANNED', 'ACHIEVED'],
          },
        },
        select: {
          id: true,
          title: true,
          description: true,
          targetAmount: true,
          currentAmount: true,
          targetDate: true,
          status: true,
        },
        orderBy: [{ status: 'asc' }, { targetDate: 'asc' }],
        take: 4,
      }),
      this.prisma.reminder.findMany({
        where: {
          userId,
          status: 'SCHEDULED',
          remindAt: {
            gte: now,
          },
        },
        select: {
          id: true,
          title: true,
          remindAt: true,
        },
        orderBy: { remindAt: 'asc' },
        take: 4,
      }),
      this.prisma.notification.findMany({
        where: {
          userId,
          isRead: false,
        },
        select: {
          id: true,
          title: true,
          message: true,
          isRead: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.insightsService.list(userId),
      this.forecastsService.getCurrent(userId),
    ]);

    const balance = balanceAggregate.reduce((total, item) => {
      const signedAmount =
        item.type === TransactionType.INCOME
          ? Number(item._sum.amount ?? 0)
          : -Number(item._sum.amount ?? 0);

      return total + signedAmount;
    }, 0);

    const summary = {
      user: {
        id: user.id,
        name: user.name,
        preferredCurrency: user.preferredCurrency,
        monthlyIncome: Number(user.monthlyIncome ?? 0),
      },
      tasks: {
        todayCount: tasksTodayCount,
        overdueCount: overdueTasksCount,
        items: tasksToday.map((task) => ({
          ...task,
          estimatedAmount:
            task.estimatedAmount !== null && task.estimatedAmount !== undefined
              ? Number(task.estimatedAmount)
              : null,
        })),
      },
      finances: {
        balance,
        monthlyExpenses: Number(monthlyExpenseAggregate._sum.amount ?? 0),
        monthlyIncome: Number(monthlyIncomeAggregate._sum.amount ?? 0),
        recentTransactions: recentTransactions.map((transaction) => ({
          ...transaction,
          amount: Number(transaction.amount),
        })),
      },
      goals: goals.map((goal) => ({
        ...goal,
        targetAmount: Number(goal.targetAmount),
        currentAmount: Number(goal.currentAmount),
      })),
      reminders,
      insights,
      forecast,
      notifications,
    };

    await this.cacheQueueService.setJson(cacheKey, summary);
    return summary;
  }
}
