import { Prisma, TransactionType } from '@prisma/client';
import { addDaysUtc, daysInMonthUtc, utcDate } from '../recurring-transactions/recurrence.util';

/**
 * Filtro de gasto do ciclo de um cartao (contrato item 9, secoes 4.3 e 4.4). Usado pelo
 * ciclo e pelo insights: manter uma so regra. Padrao com countAllPayments soma toda EXPENSE;
 * os demais somam CREDIT do proprio cartao, e o padrao soma tambem EXPENSE CREDIT sem cartao.
 */
export function cardSpendWhere(
  userId: string,
  card: { id: string; isDefault: boolean; countAllPayments: boolean },
  start: Date,
  end: Date,
): Prisma.TransactionWhereInput {
  const range = { userId, type: TransactionType.EXPENSE, date: { gte: start, lte: end } };
  if (card.isDefault && card.countAllPayments) return range;
  return { ...range, paymentMethod: 'CREDIT', ...cardScopeWhere(card) };
}

/**
 * Lancamentos de um cartao (listagem e gasto do ciclo usam a mesma regra). O padrao tambem
 * pega DESPESA CREDIT sem cartao (lancamento antigo, anterior aos cartoes nomeados); receita
 * CREDIT sem cartao nao entra, pois o gasto do ciclo so soma despesa. Cartao secundario
 * so pega o proprio cardId. O userId fica fora deste helper, sempre AND no where de quem chama.
 */
export function cardScopeWhere(card: { id: string; isDefault: boolean }): Prisma.TransactionWhereInput {
  if (!card.isDefault) return { cardId: card.id };
  return { OR: [{ cardId: card.id }, { cardId: null, paymentMethod: 'CREDIT', type: TransactionType.EXPENSE }] };
}

/** Nome do cartao criado para cada usuario (migration e cadastro). */
export const PRINCIPAL_CARD_NAME = 'Principal';

/**
 * Serializa escritores de cartao, teto e configuracao do mesmo usuario:
 * bloqueia a linha do User com FOR NO KEY UPDATE (nao bloqueia filhos).
 */
export async function lockUserForCredit(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
}

/**
 * Ocorrencia do dia de fechamento num mes especifico, clampada para meses
 * curtos (fechamento 31 em fevereiro vira 28/29). `monthIndex` pode vir fora
 * de 0-11 de proposito: Date.UTC normaliza sozinho (-1 = dezembro do ano
 * anterior, 12 = janeiro do ano seguinte), o que resolve virada de ano/mes
 * sem conta manual.
 */
function monthlyOccurrence(year: number, monthIndex: number, closingDay: number) {
  return utcDate(year, monthIndex, Math.min(closingDay, daysInMonthUtc(year, monthIndex)));
}

export type CreditCycleBounds = {
  /** Primeiro dia do ciclo (dia seguinte ao fechamento do ciclo anterior). */
  start: Date;
  /** Dia em que o ciclo fecha. Uma compra feita neste dia ainda entra nele. */
  end: Date;
};

/**
 * Ciclo de credito aberto na data `today` (meia-noite UTC do dia local do
 * usuario — mesmo padrao de recurring-transactions/recurrence.util.ts). Uma
 * compra do dia do fechamento ainda pertence a este ciclo; no dia seguinte ja
 * comeca o proximo.
 */
export function creditCycleBounds(today: Date, closingDay: number): CreditCycleBounds {
  const thisMonthEnd = monthlyOccurrence(today.getUTCFullYear(), today.getUTCMonth(), closingDay);
  const end =
    today <= thisMonthEnd
      ? thisMonthEnd
      : monthlyOccurrence(today.getUTCFullYear(), today.getUTCMonth() + 1, closingDay);
  const start = addDaysUtc(
    monthlyOccurrence(end.getUTCFullYear(), end.getUTCMonth() - 1, closingDay),
    1,
  );

  return { start, end };
}
