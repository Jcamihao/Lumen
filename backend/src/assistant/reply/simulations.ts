import { AssistantSimulation, DashboardSummary, SpendingAnalysis } from '../assistant.types';
import { formatCurrency, roundToCents, summaryCurrency } from '../format/format-values';
import { extractQuestionAmount } from '../question/question-amount';

export function buildSimulations(
  summary: DashboardSummary,
  question: string,
  spendingAnalysis: SpendingAnalysis,
) {
  const simulations: AssistantSimulation[] = [];
  const currency = summaryCurrency(summary);
  const forecastBalance = Number(summary.forecast.predictedBalance ?? 0);
  const monthlyExpenses = Number(summary.finances.monthlyExpenses ?? 0);
  const topGoal = summary.goals[0];
  const debtAmount = extractQuestionAmount(question);

  if (spendingAnalysis.topVariableCategory) {
    const { name, total } = spendingAnalysis.topVariableCategory;
    const delta = roundToCents(total * 0.1);
    simulations.push({
      id: "expense-trim-category",
      title: `Corte em ${name}`,
      summary: `"${name}" foi sua categoria de maior gasto variável nos últimos 3 meses (${formatCurrency(
        total,
        currency,
      )} no total). Enxugando 10% dela, a projeção vai para ${formatCurrency(
        forecastBalance + delta,
        currency,
      )}.`,
      monthlyDelta: delta,
      projectedBalance: forecastBalance + delta,
      confidence: "medium",
      assumptions: [
        "Baseado no histórico real de transações da categoria nos últimos 3 meses, não numa média genérica.",
        "Categoria considerada variável por oscilar de mês a mês — gastos fixos como aluguel ficam de fora.",
      ],
    });
  } else if (monthlyExpenses > 0) {
    const delta = roundToCents(monthlyExpenses * 0.1);
    simulations.push({
      id: "expense-trim-10",
      title: "Ajuste leve de gastos",
      summary: `Se você enxugar perto de 10% das saídas variáveis do mês, a projeção vai para ${formatCurrency(
        forecastBalance + delta,
        currency,
      )}.`,
      monthlyDelta: delta,
      projectedBalance: forecastBalance + delta,
      confidence: "medium",
      assumptions: [
        "Estimativa baseada nas despesas registradas neste mês.",
        "Sem categorias com histórico suficiente nos últimos 3 meses pra apontar uma específica.",
      ],
    });
  }

  if (debtAmount && spendingAnalysis.avgMonthlySurplus && spendingAnalysis.avgMonthlySurplus > 0) {
    const surplus = spendingAnalysis.avgMonthlySurplus;
    const months = Math.min(Math.max(Math.ceil(debtAmount / surplus), 1), 60);
    const monthlyParcel = roundToCents(debtAmount / months);
    simulations.push({
      id: "debt-personalized",
      title: `Parcelamento em ${months} ${months === 1 ? "mês" : "meses"}`,
      summary: `Para uma dívida aproximada de ${formatCurrency(
        debtAmount,
        currency,
      )}, usando sua sobra média real dos últimos 3 meses (${formatCurrency(
        surplus,
        currency,
      )}/mês), uma quitação em ${months} ${months === 1 ? "mês" : "meses"} sugere parcela perto de ${formatCurrency(
        monthlyParcel,
        currency,
      )}.`,
      monthlyDelta: -monthlyParcel,
      projectedBalance: forecastBalance - monthlyParcel,
      confidence: "medium",
      assumptions: [
        "Baseado na sobra média real (entradas menos saídas) dos últimos 3 meses, não num prazo fixo de 8 meses.",
        "Cálculo simplificado, sem juros, multas ou descontos de negociação.",
      ],
    });
  } else if (debtAmount) {
    const monthlyParcel = roundToCents(debtAmount / 8);
    simulations.push({
      id: "debt-8x",
      title: "Parcelamento linear em 8 meses",
      summary: `Para uma dívida aproximada de ${formatCurrency(
        debtAmount,
        currency,
      )}, uma divisão linear em 8 meses sugere parcela perto de ${formatCurrency(
        monthlyParcel,
        currency,
      )}.`,
      monthlyDelta: -monthlyParcel,
      projectedBalance: forecastBalance - monthlyParcel,
      confidence: "low",
      assumptions: [
        "Sem sobra mensal positiva nos últimos 3 meses pra personalizar o prazo — usando 8 meses como referência neutra.",
        "Cálculo simplificado, sem juros, multas ou descontos de negociação.",
      ],
    });
  }

  // Meta sem alvo nao tem "quanto falta": sem simulacao de aporte tatico pra ela.
  if (topGoal && topGoal.targetAmount !== null) {
    const remaining = Math.max(topGoal.targetAmount - topGoal.currentAmount, 0);
    const contribution = Math.min(Math.max(roundToCents(forecastBalance * 0.15), 0), remaining);

    if (contribution > 0) {
      simulations.push({
        id: "goal-contribution",
        title: `Aporte tático em ${topGoal.title}`,
        summary: `Separando ${formatCurrency(
          contribution,
          currency,
        )} para ${topGoal.title}, a projeção de caixa cairia para ${formatCurrency(
          forecastBalance - contribution,
          currency,
        )}, mas a meta ganharia tração imediata.`,
        monthlyDelta: -contribution,
        projectedBalance: forecastBalance - contribution,
        confidence: forecastBalance > contribution ? "medium" : "low",
        assumptions: [
          "Considera uso de uma parte do saldo previsto, não do saldo histórico inteiro.",
          "Não substitui revisão das prioridades básicas do mês.",
        ],
      });
    }
  }

  return simulations.slice(0, 3);
}
