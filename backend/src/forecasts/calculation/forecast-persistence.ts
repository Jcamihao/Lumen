import { PrismaService } from "../../prisma/prisma.service";
import { ForecastWindow } from "./forecast-window";
import { ForecastCalculation } from "./forecast-calculator";

export async function persistForecast(
  prisma: PrismaService,
  userId: string,
  calculation: ForecastCalculation,
  { now, horizon }: ForecastWindow,
) {
  const forecast = await prisma.forecast.create({
    data: {
      userId,
      predictedBalance: calculation.predictedBalance,
      riskLevel: calculation.riskLevel,
      referenceDate: now,
      factors: calculation.factors,
    },
  });

  // Retrato pra conferir depois (resolveMatureSnapshots, quando horizon
  // chegar) se a previsao bateu com o saldo real — Forecast sozinho so
  // guarda a ultima leitura, sem historico de acerto.
  await prisma.forecastSnapshot.create({
    data: {
      userId,
      predictedBalance: calculation.predictedBalance,
      predictedAt: now,
      targetDate: horizon,
    },
  });

  return {
    ...forecast,
    predictedBalance: Number(forecast.predictedBalance),
  };
}
