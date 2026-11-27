import { PrismaService } from "../../prisma/prisma.service";
import { localToday, utcDate } from "../../recurring-transactions/recurrence.util";

export const WINDOW_MONTHS = 3;
const LAST_WINDOW_INDEX = WINDOW_MONTHS - 1;

export type MonthIndexer = (date: Date | string) => number;

/** "Hoje" no fuso do usuario (Sao Paulo quando nao cadastrado), mesma convencao do dashboard. */
export async function loadUserToday(prisma: PrismaService, userId: string) {
  const { timezone } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  return localToday(new Date(), timezone ?? "America/Sao_Paulo");
}

/*
 * Lancamentos ficam gravados como data pura a meia-noite UTC. Por isso o
 * corte e o indice do mes usam getters UTC.
 */
export function windowSince(today: Date) {
  return utcDate(today.getUTCFullYear(), today.getUTCMonth() - LAST_WINDOW_INDEX, 1);
}

/** Indice do mes contado a partir de hoje: 0 = mes atual, 1 = anterior, 2 = dois meses atras. */
export function monthIndexer(today: Date): MonthIndexer {
  const currentMonthNumber = today.getUTCFullYear() * 12 + today.getUTCMonth();
  return (date) => {
    const value = new Date(date);
    return currentMonthNumber - (value.getUTCFullYear() * 12 + value.getUTCMonth());
  };
}

export function isInWindow(monthIndex: number) {
  return monthIndex >= 0 && monthIndex <= LAST_WINDOW_INDEX;
}

export function emptyWindow() {
  return Array.from({ length: WINDOW_MONTHS }, () => 0);
}
