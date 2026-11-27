import { RecurringTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isDueWithinRound } from '../../common/materialization/catch-up';
import { buildRecurringOccurrence, MaterializationRound } from './recurring-occurrence';
import { recordRecurring } from './recurring-claim';

/** Conta que passou da data final: encerra sem gerar mais nada. */
async function closeExpired(prisma: PrismaService, template: RecurringTransaction, due: Date) {
  await prisma.recurringTransaction.updateMany({
    where: { id: template.id, nextDueDate: due, isActive: true },
    data: { isActive: false },
  });
}

function isPastEndDate(template: RecurringTransaction, due: Date) {
  return Boolean(template.endDate && due > template.endDate);
}

/** Gera os vencimentos pendentes de uma conta fixa, em ordem. Devolve quantos lancamentos foram criados. */
export async function materializeTemplate(
  prisma: PrismaService,
  template: RecurringTransaction,
  round: MaterializationRound,
): Promise<number> {
  let due = template.nextDueDate;
  let iterations = 0;
  let created = 0;

  while (isDueWithinRound(due, round.today, iterations)) {
    iterations += 1;

    if (isPastEndDate(template, due)) {
      await closeExpired(prisma, template, due);
      break;
    }

    const occurrence = buildRecurringOccurrence(template, round, due);
    const outcome = await recordRecurring(prisma, template, due, occurrence);

    if (outcome === 'lost') {
      break;
    }
    if (outcome === 'created') {
      created += 1;
    }

    due = occurrence.next;

    if (occurrence.finished) {
      break;
    }
  }

  return created;
}
