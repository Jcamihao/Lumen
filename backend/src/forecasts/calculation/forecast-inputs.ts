import { ForecastWindow } from "./forecast-window";
import { PrismaService } from "../../prisma/prisma.service";

export type ForecastInputs = Awaited<ReturnType<typeof loadForecastInputs>>;

export async function loadForecastInputs(
  prisma: PrismaService,
  userId: string,
  { now, horizon, todayStart }: ForecastWindow,
) {
  const [user, currentTransactions, futureTransactions, pendingCostTasks] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
      }),
      prisma.transaction.findMany({
        where: {
          userId,
          date: {
            lte: now,
          },
        },
      }),
      prisma.transaction.findMany({
        where: {
          userId,
          date: {
            gte: todayStart,
            lte: horizon,
          },
        },
      }),
      prisma.task.findMany({
        where: {
          userId,
          hasFinancialImpact: true,
          status: {
            in: ["PENDING", "IN_PROGRESS"],
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

  return { user, currentTransactions, futureTransactions, pendingCostTasks };
}
