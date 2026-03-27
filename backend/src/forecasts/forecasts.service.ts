import { Injectable } from '@nestjs/common';
import { ForecastRiskLevel, TransactionType } from '@prisma/client';
import { addDays, startOfDay } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ForecastsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(userId: string) {
    const latestForecast = await this.prisma.forecast.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (latestForecast) {
      return {
        ...latestForecast,
        predictedBalance: Number(latestForecast.predictedBalance),
      };
    }

    return this.recalculateForUser(userId);
  }

  async recalculateForUser(userId: string) {
    const now = new Date();
    const horizon = addDays(now, 30);
    const todayStart = startOfDay(now);

    const [user, currentTransactions, futureTransactions, pendingCostTasks] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
        }),
        this.prisma.transaction.findMany({
          where: {
            userId,
            date: {
              lte: now,
            },
          },
        }),
        this.prisma.transaction.findMany({
          where: {
            userId,
            date: {
              gte: todayStart,
              lte: horizon,
            },
          },
        }),
        this.prisma.task.findMany({
          where: {
            userId,
            hasFinancialImpact: true,
            status: {
              in: ['PENDING', 'IN_PROGRESS'],
            },
            dueDate: {
              gte: todayStart,
              lte: horizon,
            },
            estimatedAmount: {
              not: null,
            },
          },
        }),
      ]);

    const currentBalance = currentTransactions.reduce(
      (total, transaction) =>
        total +
        this.getSignedAmount(transaction.type, Number(transaction.amount)),
      0,
    );

    const futureCashFlow = futureTransactions.reduce(
      (total, transaction) =>
        total +
        this.getSignedAmount(transaction.type, Number(transaction.amount)),
      0,
    );
    const taskCosts = pendingCostTasks.reduce(
      (total, task) => total + Number(task.estimatedAmount ?? 0),
      0,
    );

    const predictedBalance = currentBalance + futureCashFlow - taskCosts;
    const monthlyIncome = Number(user.monthlyIncome ?? 0);
    const exposure = Math.abs(futureCashFlow) + taskCosts;

    let riskLevel: ForecastRiskLevel = ForecastRiskLevel.LOW;

    if (predictedBalance < 0 || (monthlyIncome > 0 && exposure >= monthlyIncome)) {
      riskLevel = ForecastRiskLevel.HIGH;
    } else if (
      predictedBalance < monthlyIncome * 0.25 ||
      (monthlyIncome > 0 && exposure >= monthlyIncome * 0.6)
    ) {
      riskLevel = ForecastRiskLevel.MEDIUM;
    }

    const forecast = await this.prisma.forecast.create({
      data: {
        userId,
        predictedBalance,
        riskLevel,
        referenceDate: now,
        factors: {
          currentBalance,
          futureCashFlow,
          taskCosts,
          monthlyIncome,
        },
      },
    });

    return {
      ...forecast,
      predictedBalance: Number(forecast.predictedBalance),
    };
  }

  private getSignedAmount(type: TransactionType, amount: number) {
    if (type === TransactionType.INCOME) {
      return amount;
    }

    return -amount;
  }
}
