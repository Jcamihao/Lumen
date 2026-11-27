import { DashboardSummary } from '../assistant.types';
import { formatCurrency, formatDate, formatEnumLabel, goalProgress } from '../format/format-values';
import { sanitizeExternalText } from '../text/sanitize';

export function describeInsights(insights: DashboardSummary["insights"]) {
  if (!insights.length) {
    return "Insights atuais: nenhum insight ativo foi enviado.";
  }

  return `Insights atuais:\n- ${insights
    .map((insight) => {
      const persona = insight.metadata?.persona?.name;
      const voice = persona
        ? `${persona} (${formatEnumLabel(insight.type)})`
        : formatEnumLabel(insight.type);

      return `${formatEnumLabel(insight.severity)} | ${voice} | ${sanitizeExternalText(insight.message)}`;
    })
    .join("\n- ")}`;
}

export function describeDecisionAnchors(
  tasks: DashboardSummary["tasks"]["items"],
  transactions: DashboardSummary["finances"]["recentTransactions"],
  goals: DashboardSummary["goals"],
  insights: DashboardSummary["insights"],
  currency: string,
) {
  const primaryTask = tasks[0];
  const financialTask = tasks.find((task) => task.hasFinancialImpact);
  const latestExpense = transactions.find(
    (transaction) => transaction.type === "EXPENSE",
  );
  const latestIncome = transactions.find(
    (transaction) => transaction.type === "INCOME",
  );
  const primaryGoal = goals[0];
  const priorityInsight =
    insights.find((insight) => insight.severity === "CRITICAL") ??
    insights.find((insight) => insight.severity === "WARNING") ??
    insights[0];

  const anchors = [
    primaryTask
      ? `Tarefa mais prioritária para citar pelo nome: ${sanitizeExternalText(primaryTask.title)}${primaryTask.dueDate ? `, vence ${formatDate(primaryTask.dueDate)}` : ""}${primaryTask.priority ? `, prioridade ${formatEnumLabel(primaryTask.priority)}` : ""}.`
      : null,
    financialTask
      ? `Tarefa com impacto financeiro direto: ${sanitizeExternalText(financialTask.title)}${financialTask.estimatedAmount ? `, impacto estimado ${formatCurrency(Number(financialTask.estimatedAmount), currency)}` : ""}.`
      : null,
    latestExpense
      ? `Saída concreta para mencionar se fizer sentido: ${sanitizeExternalText(latestExpense.description)}, ${formatCurrency(Number(latestExpense.amount), currency)} em ${formatDate(latestExpense.date)}.`
      : null,
    latestIncome
      ? `Entrada concreta disponível: ${sanitizeExternalText(latestIncome.description)}, ${formatCurrency(Number(latestIncome.amount), currency)} em ${formatDate(latestIncome.date)}.`
      : null,
    primaryGoal
      ? primaryGoal.targetAmount === null
        ? `Meta concreta para conectar na resposta: ${sanitizeExternalText(primaryGoal.title)}, ${formatCurrency(primaryGoal.currentAmount, currency)} guardados (sem valor-alvo).`
        : `Meta concreta para conectar na resposta: ${sanitizeExternalText(primaryGoal.title)}, ${goalProgress(primaryGoal)}% concluida.`
      : null,
    priorityInsight
      ? `Insight mais acionável no momento: ${sanitizeExternalText(priorityInsight.message)}.`
      : null,
  ].filter(Boolean);

  if (!anchors.length) {
    return "Âncoras concretas: nenhum item nomeado relevante foi enviado.";
  }

  return `Âncoras concretas preferenciais:\n- ${anchors.join("\n- ")}`;
}
