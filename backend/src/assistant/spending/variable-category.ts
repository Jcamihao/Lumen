import { TransactionType } from "@prisma/client";
import { SpendingAnalysis } from "../assistant.types";
import { RecentTransaction } from "./recent-transactions";
import { MonthIndexer, WINDOW_MONTHS, emptyWindow, isInWindow } from "./spending-window";

/** Abaixo disto a oscilacao mensal e pequena demais: provavel conta fixa (ex.: aluguel), nao gasto variavel. */
const MAX_FIXED_VARIATION = 0.2;

type TopCategory = SpendingAnalysis["topVariableCategory"];

/**
 * Categoria de maior gasto variavel: agrupa EXPENSE por categoria em baldes
 * mensais, descarta quem tem pouca oscilacao e escolhe a de maior total.
 */
export function topVariableCategory(transactions: RecentTransaction[], monthIndexOf: MonthIndexer): TopCategory {
  let top: TopCategory = null;
  for (const [name, monthly] of expenseBuckets(transactions, monthIndexOf)) {
    const total = monthly.reduce((sum, value) => sum + value, 0);
    const mean = total / WINDOW_MONTHS;
    if (mean <= 0 || isFixedLike(monthly, mean)) continue;

    if (!top || total > top.total) {
      top = { name, total };
    }
  }
  return top;
}

function expenseBuckets(transactions: RecentTransaction[], monthIndexOf: MonthIndexer) {
  const buckets = new Map<string, number[]>();
  for (const transaction of transactions) {
    const index = monthIndexOf(transaction.date);
    if (transaction.type !== TransactionType.EXPENSE || !transaction.category?.name) continue;
    if (!isInWindow(index)) continue;

    const name = transaction.category.name;
    const bucket = buckets.get(name) ?? emptyWindow();
    bucket[index] += Number(transaction.amount);
    buckets.set(name, bucket);
  }
  return buckets;
}

function isFixedLike(monthly: number[], mean: number) {
  const variance = monthly.reduce((sum, value) => sum + (value - mean) ** 2, 0) / WINDOW_MONTHS;
  const coefficientOfVariation = Math.sqrt(variance) / mean;
  return coefficientOfVariation <= MAX_FIXED_VARIATION;
}
