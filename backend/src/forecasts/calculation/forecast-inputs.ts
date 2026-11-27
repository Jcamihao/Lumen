import { ForecastWindow } from "./forecast-window";
import { PrismaService } from "../../prisma/prisma.service";

export type ForecastInputs = Awaited<ReturnType<typeof loadForecastInputs>>;

function findCurrentTransactions(prisma: PrismaService, userId: string, { now }: ForecastWindow) {
  return prisma.transaction.findMany({
    where: { userId, date: { lte: now } },
  });
}

function findFutureTransactions(
  prisma: PrismaService,
  userId: string,
  { todayStart, horizon }: ForecastWindow,
) {
  return prisma.transaction.findMany({
    where: { userId, date: { gte: todayStart, lte: horizon } },
  });
}

function findPendingCostTasks(
  prisma: PrismaService,
  userId: string,
  { todayStart, horizon }: ForecastWindow,
) {
  return prisma.task.findMany({
    where: {
      userId,
      hasFinancialImpact: true,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      dueDate: { gte: todayStart, lte: horizon },
      estimatedAmount: { not: null },
    },
  });
}

export async function loadForecastInputs(
  prisma: PrismaService,
  userId: string,
  window: ForecastWindow,
) {
  const [user, currentTransactions, futureTransactions, pendingCostTasks] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      findCurrentTransactions(prisma, userId, window),
      findFutureTransactions(prisma, userId, window),
      findPendingCostTasks(prisma, userId, window),
    ]);

  return { user, currentTransactions, futureTransactions, pendingCostTasks };
}
