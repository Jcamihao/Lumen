import { RecurringTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { candidateCutoff } from '../../common/materialization/due-window';

/** Contas fixas ativas com vencimento que pode ter passado em algum fuso. */
export function findCandidateTemplates(
  prisma: PrismaService,
  userId: string,
  now: Date,
): Promise<RecurringTransaction[]> {
  return prisma.recurringTransaction.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: { lte: candidateCutoff(now) },
    },
  });
}
