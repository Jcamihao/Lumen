import { DashboardSummary } from '../../assistant.types';
import { formatCurrency, formatDate } from '../../format/format-values';
import { detectIntent } from '../../question/intent';
import { criticalInsightsOf, nextTasksOf } from './local-context';

export function localAnswer(summary: DashboardSummary, intent: ReturnType<typeof detectIntent>, currency: string) {
  if (intent === "priorities") {
    return priorityAnswer(summary);
  }
  if (intent === "finance_overview") {
    return financeAnswer(summary, currency);
  }
  return todayAnswer(summary, currency);
}

function priorityAnswer(summary: DashboardSummary) {
  const priorities = nextTasksOf(summary)
    .map(
      (task) =>
        `${task.title}${task.dueDate ? ` (${formatDate(task.dueDate)})` : ""}`,
    )
    .join(", ");

  return (
    `Hoje eu puxaria a fila por ${priorities || "tarefas sem prazo imediato"}. ` +
    "Comece pelo que vence antes, tem impacto financeiro ou destrava o resto do dia."
  );
}

function financeAnswer(summary: DashboardSummary, currency: string) {
  return (
    `Seu saldo atual esta em ${formatCurrency(summary.finances.balance, currency)}. ` +
    `Neste mes voce movimentou ${formatCurrency(summary.finances.monthlyIncome, currency)} em entradas, ` +
    `${formatCurrency(summary.finances.monthlyExpenses, currency)} em saidas ` +
    `e a previsao aponta risco ${String(summary.forecast.riskLevel).toLowerCase()}.`
  );
}

function todayAnswer(summary: DashboardSummary, currency: string) {
  const criticalCount = criticalInsightsOf(summary).length;
  return (
    `Hoje voce tem ${summary.tasks.todayCount} tarefa(s) para o dia, ${summary.tasks.overdueCount} atrasada(s) e ` +
    `${criticalCount > 0 ? `${criticalCount} alerta(s) critico(s)` : "nenhum alerta critico"}. ` +
    `A previsao financeira atual esta em ${formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)}.`
  );
}
