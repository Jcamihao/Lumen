import { Injectable } from '@nestjs/common';
import { ForecastRiskLevel, TransactionType } from '@prisma/client';
import { addDays, getDaysInMonth, startOfDay } from 'date-fns';
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

    const monthlyIncome = Number(user.monthlyIncome ?? 0);
    const daysInMonth = getDaysInMonth(now);
    const remainingDays = daysInMonth - now.getDate();
    const projectedMonthlyIncome =
      monthlyIncome > 0 ? (monthlyIncome / daysInMonth) * remainingDays : 0;

    const predictedBalance =
      currentBalance + futureCashFlow - taskCosts + projectedMonthlyIncome;
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
          projectedMonthlyIncome,
          remainingDays,
        },
      },
    });

    // Retrato pra conferir depois (resolveMatureSnapshots, quando horizon
    // chegar) se a previsao bateu com o saldo real — Forecast sozinho so
    // guarda a ultima leitura, sem historico de acerto.
    await this.prisma.forecastSnapshot.create({
      data: {
        userId,
        predictedBalance,
        predictedAt: now,
        targetDate: horizon,
      },
    });

    return {
      ...forecast,
      predictedBalance: Number(forecast.predictedBalance),
    };
  }

  /**
   * Roda no pulse scan (uma vez por dia por usuario, mesmo gatilho do
   * aporte automatico de metas). Fecha todo snapshot cujo targetDate ja
   * chegou: compara a previsao gravada com o saldo real de hoje e grava o
   * erro percentual, uma unica vez (resolvedAt marca isso).
   */
  async resolveMatureSnapshots(userId: string): Promise<number> {
    const now = new Date();

    const due = await this.prisma.forecastSnapshot.findMany({
      where: { userId, targetDate: { lte: now }, resolvedAt: null },
    });

    if (due.length === 0) return 0;

    const actualBalance = await this.computeBalanceAsOf(userId, now);

    for (const snapshot of due) {
      const predicted = Number(snapshot.predictedBalance);
      const errorPercent =
        predicted !== 0
          ? ((actualBalance - predicted) / Math.abs(predicted)) * 100
          : actualBalance === 0
            ? 0
            : 100;

      await this.prisma.forecastSnapshot.update({
        where: { id: snapshot.id },
        data: { actualBalance, errorPercent, resolvedAt: now },
      });
    }

    return due.length;
  }

  /**
   * Ultima previsao ja conferida, pra mostrar "sua previsao de [data]
   * errou por X%" em Financas. Null enquanto nenhum snapshot chegou no
   * targetDate ainda (primeiros 30 dias de uso nao tem o que mostrar).
   */
  async getLatestAccuracy(userId: string) {
    const snapshot = await this.prisma.forecastSnapshot.findFirst({
      where: { userId, resolvedAt: { not: null } },
      orderBy: { resolvedAt: 'desc' },
    });

    if (!snapshot) return null;

    return {
      targetDate: snapshot.targetDate,
      predictedBalance: Number(snapshot.predictedBalance),
      actualBalance: Number(snapshot.actualBalance),
      errorPercent: Number(snapshot.errorPercent),
      resolvedAt: snapshot.resolvedAt,
    };
  }

  private async computeBalanceAsOf(userId: string, asOf: Date) {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId, date: { lte: asOf } },
    });

    return transactions.reduce(
      (total, transaction) =>
        total + this.getSignedAmount(transaction.type, Number(transaction.amount)),
      0,
    );
  }

  private getSignedAmount(type: TransactionType, amount: number) {
    if (type === TransactionType.INCOME) {
      return amount;
    }

    return -amount;
  }
}
