import { PrismaService } from '../../prisma/prisma.service';
import { cardSpendWhere, creditCycleBounds } from '../../credit-cycle/credit-cycle.util';
import { InsightContext } from './insight-context.types';

const DEFAULT_CLOSING_DAY = 30;

function findCeiling(prisma: PrismaService, cardId: string, closingDate: Date) {
  return prisma.creditCycleCeiling.findUnique({ where: { cardId_closingDate: { cardId, closingDate } } });
}

function aggregateCardSpend(
  prisma: PrismaService,
  userId: string,
  card: Parameters<typeof cardSpendWhere>[1],
  cycle: { start: Date; end: Date },
) {
  return prisma.transaction.aggregate({
    where: cardSpendWhere({ userId }, card, cycle.start, cycle.end),
    _sum: { amount: true },
  });
}

/**
 * 9c-2: o ciclo de credito e do cartao padrao (contrato item 9, secao 4.8); sem
 * cartao (estado corrompido), cai no fechamento 30 e vencimento null.
 */
export async function loadCreditCycle(
  prisma: PrismaService,
  userId: string,
  userToday: Date,
): Promise<InsightContext['creditCycle']> {
  const defaultCard = await prisma.creditCard.findFirst({
    where: { userId, isDefault: true, archivedAt: null },
    select: { id: true, isDefault: true, countAllPayments: true, closingDay: true, dueDay: true },
  });
  const cycle = creditCycleBounds(userToday, defaultCard?.closingDay ?? DEFAULT_CLOSING_DAY);
  const [ceilingRow, spentAggregate] = await Promise.all([
    defaultCard ? findCeiling(prisma, defaultCard.id, cycle.end) : Promise.resolve(null),
    // Mesma regra do ciclo do cartao (cardSpendWhere). Sem cartao padrao ativo: gasto zero.
    defaultCard
      ? aggregateCardSpend(prisma, userId, defaultCard, cycle)
      : Promise.resolve({ _sum: { amount: null } }),
  ]);
  return {
    closingDate: cycle.end,
    dueDay: defaultCard?.dueDay ?? null,
    ceiling: ceilingRow ? Number(ceilingRow.ceiling) : null,
    spent: Number(spentAggregate._sum.amount ?? 0),
  };
}
