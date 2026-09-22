import { utcDate } from '../recurring-transactions/recurrence.util';

/** Primeiro dia (meia-noite UTC) do mes de `date`. Chave de um deposito mensal. */
export function monthStart(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** Primeiro dia do mes seguinte a `date`. Date.UTC normaliza a virada de ano sozinho. */
export function nextMonthStart(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * Todo primeiro-dia-do-mes de `from` (inclusive) ate `to` (inclusive), em
 * ordem. Usado para descobrir quais meses ainda nao tem deposito.
 */
export function monthsBetween(from: Date, to: Date): Date[] {
  const months: Date[] = [];
  let cursor = monthStart(from);
  const end = monthStart(to);

  while (cursor <= end) {
    months.push(cursor);
    cursor = nextMonthStart(cursor);
  }

  return months;
}
