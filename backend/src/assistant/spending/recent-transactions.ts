import { Prisma, TransactionType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export type RecentTransaction = {
  type: TransactionType;
  amount: Prisma.Decimal | number;
  date: Date;
  category: { name: string } | null;
};

export function findRecentTransactions(
  prisma: PrismaService,
  userId: string,
  since: Date,
): Promise<RecentTransaction[]> {
  return prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: since },
      type: { in: [TransactionType.INCOME, TransactionType.EXPENSE, TransactionType.TRANSFER] },
    },
    select: {
      type: true,
      amount: true,
      date: true,
      category: { select: { name: true } },
    },
  });
}
