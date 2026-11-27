import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { calculateForecast } from './calculation/forecast-calculator';
import { loadForecastInputs } from './calculation/forecast-inputs';
import { persistForecast } from './calculation/forecast-persistence';
import { errorPercentOf } from './calculation/snapshot-error';
import { sumSignedAmounts } from './calculation/signed-amount';
import { forecastWindow } from './calculation/forecast-window';

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
    const window = forecastWindow(new Date());
    const inputs = await loadForecastInputs(this.prisma, userId, window);
    const calculation = calculateForecast(inputs, window.now);

    return persistForecast(this.prisma, userId, calculation, window);
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
      const errorPercent = errorPercentOf(Number(snapshot.predictedBalance), actualBalance);
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

    return sumSignedAmounts(transactions);
  }
}
