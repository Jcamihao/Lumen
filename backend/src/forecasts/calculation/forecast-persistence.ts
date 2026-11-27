import { PrismaService } from "../../prisma/prisma.service";
import { ForecastWindow } from "./forecast-window";
import { ForecastCalculation } from "./forecast-calculator";

// Retrato pra conferir depois (resolveMatureSnapshots, quando horizon
// chegar) se a previsao bateu com o saldo real — Forecast sozinho so
// guarda a ultima leitura, sem historico de acerto.
function createSnapshot(
  prisma: PrismaService,
  userId: string,
  { predictedBalance }: ForecastCalculation,
  { now, horizon }: ForecastWindow,
) {
  return prisma.forecastSnapshot.create({
    data: { userId, predictedBalance, predictedAt: now, targetDate: horizon },
  });
}

export async function persistForecast(
  prisma: PrismaService,
  userId: string,
  calculation: ForecastCalculation,
  window: ForecastWindow,
) {
  const forecast = await prisma.forecast.create({
    data: {
      userId,
      predictedBalance: calculation.predictedBalance,
      riskLevel: calculation.riskLevel,
      referenceDate: window.now,
      factors: calculation.factors,
    },
  });

  await createSnapshot(prisma, userId, calculation, window);

  return { ...forecast, predictedBalance: Number(forecast.predictedBalance) };
}
