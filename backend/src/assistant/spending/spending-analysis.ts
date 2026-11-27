import { PrismaService } from "../../prisma/prisma.service";
import { SpendingAnalysis } from '../assistant.types';
import { averageMonthlySurplus } from "./monthly-surplus";
import { findRecentTransactions } from "./recent-transactions";
import { loadUserToday, monthIndexer, windowSince } from "./spending-window";
import { topVariableCategory } from "./variable-category";

/**
 * Analisa transacoes reais dos ultimos 3 meses pra alimentar as
 * simulacoes: qual categoria de gasto variavel tem mais folga pra cortar
 * (em vez de "10% fixo" generico), e qual a sobra media mensal real do
 * usuario (em vez de "8 meses fixo" pra qualquer divida).
 */
export async function analyzeSpending(prisma: PrismaService, userId: string): Promise<SpendingAnalysis> {
  const today = await loadUserToday(prisma, userId);
  const monthIndexOf = monthIndexer(today);
  const transactions = await findRecentTransactions(prisma, userId, windowSince(today));

  return {
    topVariableCategory: topVariableCategory(transactions, monthIndexOf),
    avgMonthlySurplus: transactions.length > 0 ? averageMonthlySurplus(transactions, monthIndexOf) : null,
  };
}
