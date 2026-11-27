import { InstallmentPurchase, Prisma, RecurrenceFrequency, TransactionType } from '@prisma/client';
import { nextOccurrence } from '../../recurring-transactions/recurrence.util';

/** Parcela a gerar: o proximo vencimento, o avanco do contador e o lancamento a criar. */
export interface InstallmentStep {
  next: Date | null;
  claimData: { installmentsGenerated: number; nextDueDate: Date | null; isActive?: false };
  row: Prisma.TransactionUncheckedCreateInput;
}

/** A ultima parcela absorve a sobra do arredondamento, pra soma bater com totalAmount. */
function amountFor(plan: InstallmentPurchase, isLast: boolean) {
  return isLast
    ? plan.totalAmount.minus(plan.installmentAmount.times(plan.installmentsTotal - 1))
    : plan.installmentAmount;
}

function buildRow(
  plan: InstallmentPurchase,
  userId: string,
  due: Date,
  installmentNumber: number,
  amount: Prisma.Decimal,
): Prisma.TransactionUncheckedCreateInput {
  return {
    userId,
    type: TransactionType.EXPENSE,
    description: plan.description,
    amount,
    date: due,
    categoryId: plan.categoryId,
    paymentMethod: plan.paymentMethod,
    // Herda o cartao da compra (nulo = cartao padrao). Arquivar depois nao impede.
    cardId: plan.cardId,
    installmentPurchaseId: plan.id,
    installmentNumber,
    installmentsTotal: plan.installmentsTotal,
  };
}

export function buildInstallmentStep(
  plan: InstallmentPurchase,
  userId: string,
  due: Date,
  installmentNumber: number,
): InstallmentStep {
  const isLast = installmentNumber === plan.installmentsTotal;
  const next = isLast ? null : nextOccurrence(due, RecurrenceFrequency.MONTHLY, plan.anchorDay);

  return {
    next,
    claimData: {
      installmentsGenerated: installmentNumber,
      nextDueDate: next,
      ...(isLast ? { isActive: false } : {}),
    },
    row: buildRow(plan, userId, due, installmentNumber, amountFor(plan, isLast)),
  };
}
