import { RecurringTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OccurrenceOutcome, recordOccurrence } from '../../common/materialization/record-occurrence';
import { RecurringOccurrence } from './recurring-occurrence';

export function recordRecurring(
  prisma: PrismaService,
  template: RecurringTransaction,
  due: Date,
  occurrence: RecurringOccurrence,
): Promise<OccurrenceOutcome> {
  return recordOccurrence(prisma, {
    claim: (db) =>
      db.recurringTransaction.updateMany({
        where: { id: template.id, nextDueDate: due, isActive: true },
        data: occurrence.claimData,
      }),
    insert: (tx) => tx.transaction.create({ data: occurrence.row }),
  });
}
