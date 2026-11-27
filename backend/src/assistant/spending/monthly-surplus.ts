import { TransactionType } from "@prisma/client";
import { RecentTransaction } from "./recent-transactions";
import { MonthIndexer, WINDOW_MONTHS, emptyWindow, isInWindow } from "./spending-window";

/**
 * Sobra media mensal real (entradas - saidas - transferencias), mesma
 * convencao de sinal usada no resto do app (ForecastsService, saldo do
 * dashboard): so INCOME e positivo.
 */
export function averageMonthlySurplus(transactions: RecentTransaction[], monthIndexOf: MonthIndexer) {
  const monthlyNet = emptyWindow();
  for (const transaction of transactions) {
    const index = monthIndexOf(transaction.date);
    if (!isInWindow(index)) continue;

    const amount = Number(transaction.amount);
    monthlyNet[index] += transaction.type === TransactionType.INCOME ? amount : -amount;
  }
  return monthlyNet.reduce((sum, value) => sum + value, 0) / WINDOW_MONTHS;
}
