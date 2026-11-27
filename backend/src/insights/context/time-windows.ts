import { endOfDay, startOfDay, startOfMonth } from 'date-fns';

export type TimeWindows = {
  now: Date;
  todayStart: Date;
  todayEnd: Date;
  monthStart: Date;
  currentMonthStartUtc: Date;
  previousMonthStart: Date;
  previousMonthEnd: Date;
};

export function buildTimeWindows(now: Date): TimeWindows {
  // Limites UTC (datas de transacao sao gravadas a meia-noite UTC).
  const currentMonthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    now,
    todayStart: startOfDay(now),
    todayEnd: endOfDay(now),
    monthStart: startOfMonth(now),
    currentMonthStartUtc,
    previousMonthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    previousMonthEnd: new Date(currentMonthStartUtc.getTime() - 1),
  };
}
