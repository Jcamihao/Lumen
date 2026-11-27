import { InstallmentPurchase } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { candidateCutoff } from '../../common/materialization/due-window';

/** Compras ativas com parcela que pode ter vencido em algum fuso. */
export function findCandidatePlans(prisma: PrismaService, userId: string, now: Date): Promise<InstallmentPurchase[]> {
  return prisma.installmentPurchase.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: { lte: candidateCutoff(now) },
    },
  });
}
