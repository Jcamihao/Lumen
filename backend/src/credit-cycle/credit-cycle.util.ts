import { addDaysUtc, daysInMonthUtc, utcDate } from '../recurring-transactions/recurrence.util';

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
