import { PrismaService } from "../../prisma/prisma.service";
import { SpendingAnalysis } from '../assistant.types';
import { localToday, utcDate } from "../../recurring-transactions/recurrence.util";
import { TransactionType } from "@prisma/client";

/**
 * Analisa transacoes reais dos ultimos 3 meses pra alimentar as
 * simulacoes: qual categoria de gasto variavel tem mais folga pra cortar
 * (em vez de "10% fixo" generico), e qual a sobra media mensal real do
 * usuario (em vez de "8 meses fixo" pra qualquer divida).
 */
export async function analyzeSpending(prisma: PrismaService, userId: string): Promise<SpendingAnalysis> {
  // Lancamentos ficam gravados como data pura a meia-noite UTC. Por isso o
  // corte e o indice do mes usam getters UTC, e so o "mes atual" depende do
  // fuso do usuario (mesma convencao do dashboard). Usar o fuso do processo
  // exclui ou desloca de mes tudo que cai no dia 1 quando o servidor nao
  // esta em UTC.
  const { timezone } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  const today = localToday(new Date(), timezone ?? "America/Sao_Paulo");
  const currentMonthNumber = today.getUTCFullYear() * 12 + today.getUTCMonth();
  const since = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 2, 1);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: since },
      type: { in: [TransactionType.INCOME, TransactionType.EXPENSE, TransactionType.TRANSFER] },
    },
    select: {
      type: true,
      amount: true,
      date: true,
      category: { select: { name: true } },
    },
  });

  const monthIndexOf = (date: Date) =>
    currentMonthNumber - (date.getUTCFullYear() * 12 + date.getUTCMonth());

  // Sobra media mensal real (entradas - saidas - transferencias), mesma
  // convencao de sinal usada no resto do app (ForecastsService, saldo do
  // dashboard): so INCOME e positivo.
  const monthlyNet = [0, 0, 0];
  for (const transaction of transactions) {
    const index = monthIndexOf(new Date(transaction.date));
    if (index < 0 || index > 2) continue;

    const amount = Number(transaction.amount);
    monthlyNet[index] += transaction.type === TransactionType.INCOME ? amount : -amount;
  }
  const avgMonthlySurplus = monthlyNet.reduce((sum, value) => sum + value, 0) / 3;

  // Categoria de maior gasto variavel: agrupa EXPENSE por categoria em
  // baldes mensais e descarta quem tem pouca oscilacao (provavel conta
  // fixa, tipo aluguel) antes de escolher a de maior total.
  const categoryBuckets = new Map<string, number[]>();
  for (const transaction of transactions) {
    if (transaction.type !== TransactionType.EXPENSE || !transaction.category?.name) continue;

    const index = monthIndexOf(new Date(transaction.date));
    if (index < 0 || index > 2) continue;

    const name = transaction.category.name;
    const bucket = categoryBuckets.get(name) ?? [0, 0, 0];
    bucket[index] += Number(transaction.amount);
    categoryBuckets.set(name, bucket);
  }

  let topVariableCategory: SpendingAnalysis["topVariableCategory"] = null;
  for (const [name, monthly] of categoryBuckets) {
    const total = monthly.reduce((sum, value) => sum + value, 0);
    const mean = total / 3;
    if (mean <= 0) continue;

    const variance = monthly.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3;
    const coefficientOfVariation = Math.sqrt(variance) / mean;

    // cv baixo = valor quase identico todo mes = provavel gasto fixo,
    // nao "variavel" — nao serve pra sugestao de corte.
    if (coefficientOfVariation <= 0.2) continue;

    if (!topVariableCategory || total > topVariableCategory.total) {
      topVariableCategory = { name, total };
    }
  }

  return {
    topVariableCategory,
    avgMonthlySurplus: transactions.length > 0 ? avgMonthlySurplus : null,
  };
}
