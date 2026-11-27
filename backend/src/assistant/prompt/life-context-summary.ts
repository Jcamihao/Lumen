import { DashboardSummary } from '../assistant.types';
import { formatCurrency, goalProgress, summaryCurrency } from '../format/format-values';
import { extractFirstName, sanitizeExternalText } from '../text/sanitize';

export function buildLifeContextSummary(summary: DashboardSummary) {
  const criticalCount = summary.insights.filter(
    (insight) => insight.severity === "CRITICAL",
  ).length;
  const nextGoal = summary.goals[0];
  const currency = summaryCurrency(summary);
  const firstName = extractFirstName(summary.user.name);

  return [
    `${firstName} tem ${summary.tasks.todayCount} tarefa(s) para hoje e ${summary.tasks.overdueCount} atrasada(s).`,
    criticalCount
      ? `${criticalCount} alerta(s) critico(s) ja foram detectados pelo motor de insights.`
      : "Nao ha alerta critico aberto neste momento.",
    `Saldo atual em ${formatCurrency(summary.finances.balance, currency)} com previsao de ${formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)} e risco ${String(summary.forecast.riskLevel).toLowerCase()}.`,
    nextGoal
      ? nextGoal.targetAmount === null
        ? `Meta em foco: ${sanitizeExternalText(nextGoal.title)}, ${formatCurrency(nextGoal.currentAmount, currency)} guardados (sem valor-alvo).`
        : `Meta em foco: ${sanitizeExternalText(nextGoal.title)}, ${goalProgress(nextGoal)}% concluida.`
      : "Nenhuma meta ativa precisa de destaque imediato agora.",
  ].join(" ");
}
