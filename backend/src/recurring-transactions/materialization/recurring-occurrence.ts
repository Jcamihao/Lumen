import { Prisma, RecurringTransaction } from '@prisma/client';
import { nextOccurrence } from '../../recurring-transactions/recurrence.util';

/** Rodada de geracao: quem, quando e qual "hoje" do usuario. */
export interface MaterializationRound {
  userId: string;
  now: Date;
  today: Date;
}

/** Lancamento a gerar para um vencimento, com o avanco do calendario e o encerramento. */
export interface RecurringOccurrence {
  next: Date;
  finished: boolean;
  claimData: { nextDueDate: Date; lastGeneratedAt: Date; isActive?: false };
  row: Prisma.TransactionUncheckedCreateInput;
}

export function buildRecurringOccurrence(
  template: RecurringTransaction,
  round: MaterializationRound,
  due: Date,
): RecurringOccurrence {
  const next = nextOccurrence(due, template.frequency, template.anchorDay);
  const finished = Boolean(template.endDate && next > template.endDate);

  return {
    next,
    finished,
    claimData: {
      nextDueDate: next,
      lastGeneratedAt: round.now,
      ...(finished ? { isActive: false } : {}),
    },
    row: {
      userId: round.userId,
      type: template.type,
      description: template.description,
      amount: template.amount,
      date: due,
      categoryId: template.categoryId,
      paymentMethod: template.paymentMethod,
      // Herda o cartao do modelo (nulo = cartao padrao). Arquivar depois nao impede.
      cardId: template.cardId,
      recurringTransactionId: template.id,
    },
  };
}
