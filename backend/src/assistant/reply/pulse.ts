import { AssistantProactiveSignal, DashboardSummary } from '../assistant.types';
import { formatCurrency, summaryCurrency } from '../format/format-values';

export function buildPulseSummary(
  summary: DashboardSummary,
  signals: AssistantProactiveSignal[],
) {
  if (signals[0]) {
    return signals[0].message;
  }

  return `Seu momento está estável: ${summary.tasks.todayCount} tarefa(s) para hoje, ${summary.goals.length} meta(s) ativa(s) e previsão em ${formatCurrency(
    Number(summary.forecast.predictedBalance ?? 0),
    summaryCurrency(summary),
  )}.`;
}

export function buildPulseQuestion(summary: DashboardSummary) {
  if (summary.forecast.riskLevel === "HIGH") {
    return "O que eu preciso proteger primeiro no meu caixa esta semana?";
  }

  if (summary.tasks.overdueCount > 0) {
    return "Qual pendência atrasada eu devo limpar antes do resto?";
  }

  if (summary.goals.length > 0) {
    return `Como acelerar a meta ${summary.goals[0].title} sem bagunçar o mês?`;
  }

  return "Onde vale colocar energia agora para ganhar mais tração?";
}
