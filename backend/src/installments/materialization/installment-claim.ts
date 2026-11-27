import { InstallmentPurchase } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OccurrenceOutcome, recordOccurrence } from '../../common/materialization/record-occurrence';
import { InstallmentStep } from './installment-charge';

export function recordInstallment(
  prisma: PrismaService,
  plan: InstallmentPurchase,
  due: Date,
  step: InstallmentStep,
): Promise<OccurrenceOutcome> {
  return recordOccurrence(prisma, {
    claim: (db) =>
      db.installmentPurchase.updateMany({
        where: { id: plan.id, nextDueDate: due, isActive: true },
        data: step.claimData,
      }),
    insert: (tx) => tx.transaction.create({ data: step.row }),
  });
}
