import { TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DateRange } from '../today-window';

const RECENT_TRANSACTIONS_LIMIT = 6;

export function sumBalanceByType(prisma: PrismaService, userId: string) {
  return prisma.transaction.groupBy({
    where: { userId },
    by: ['type'],
    _sum: { amount: true },
  });
}

export function findRecentTransactions(prisma: PrismaService, userId: string) {
  return prisma.transaction.findMany({
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
    take: RECENT_TRANSACTIONS_LIMIT,
  });
}

export function sumMonthlyTransactions(
  prisma: PrismaService,
  userId: string,
  type: TransactionType,
  month: DateRange,
) {
  return prisma.transaction.aggregate({
    where: { userId, type, date: { gte: month.start, lt: month.end } },
    _sum: { amount: true },
  });
}
