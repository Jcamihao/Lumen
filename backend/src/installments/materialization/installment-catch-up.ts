import { InstallmentPurchase } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isDueWithinRound } from '../../common/materialization/catch-up';
import { buildInstallmentStep } from './installment-charge';
import { recordInstallment } from './installment-claim';

/** Gera as parcelas vencidas de uma compra, em ordem. Devolve quantas foram criadas. */
export async function materializePlan(
  prisma: PrismaService,
  userId: string,
  plan: InstallmentPurchase,
  today: Date,
): Promise<number> {
  let due = plan.nextDueDate as Date;
  let installmentNumber = plan.installmentsGenerated + 1;
  let iterations = 0;
  let created = 0;

  while (isDueWithinRound(due, today, iterations) && installmentNumber <= plan.installmentsTotal) {
    iterations += 1;
    const step = buildInstallmentStep(plan, userId, due, installmentNumber);
    const outcome = await recordInstallment(prisma, plan, due, step);

    if (outcome === 'lost') {
      break;
    }
    if (outcome === 'created') {
      created += 1;
    }
    if (step.next === null) {
      break;
    }

    due = step.next;
    installmentNumber += 1;
  }

  return created;
}
