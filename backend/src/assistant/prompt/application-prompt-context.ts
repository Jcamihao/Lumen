import { DashboardSummary } from '../assistant.types';
import { formatCurrency, summaryCurrency } from '../format/format-values';
import { extractFirstName } from '../text/sanitize';
import { describeUserProfile } from './describe-profile';
import { describeDecisionAnchors, describeInsights } from './describe-insights';
import { describeNotifications, describeReminders, describeTasks } from './describe-work';
import { describeGoals, describeTransactions } from './describe-finance';

export function buildApplicationPromptContext(
  summary: DashboardSummary,
  intent: "today_overview" | "priorities" | "finance_overview" | "general",
) {
  const currency = summaryCurrency(summary);
  const criticalInsights = summary.insights.filter(
    (insight) => insight.severity === "CRITICAL",
  );
  const warningInsights = summary.insights.filter(
    (insight) => insight.severity === "WARNING",
  );
  const openTasks = summary.tasks.items.slice(0, 5);
  const recentTransactions = summary.finances.recentTransactions.slice(0, 5);
  const goals = summary.goals.slice(0, 4);
  const reminders = summary.reminders.slice(0, 4);
  const notifications = summary.notifications.slice(0, 4);
  const firstName = extractFirstName(summary.user.name);

  return [
    `Intenção principal da resposta: ${intent}.`,
    `Usuario em analise: ${firstName}.`,
    describeUserProfile(summary.user),
    `Leitura do dia: ${summary.tasks.todayCount} tarefa(s) para hoje, ${summary.tasks.overdueCount} atrasada(s), ${criticalInsights.length} insight(s) critico(s) e ${warningInsights.length} insight(s) de atencao.`,
    `Leitura financeira: saldo atual ${formatCurrency(summary.finances.balance, currency)}, entradas no mes ${formatCurrency(summary.finances.monthlyIncome, currency)}, saidas no mes ${formatCurrency(summary.finances.monthlyExpenses, currency)}, previsao ${formatCurrency(Number(summary.forecast.predictedBalance ?? 0), currency)} e risco ${String(summary.forecast.riskLevel).toLowerCase()}.`,
    describeDecisionAnchors(openTasks, recentTransactions, goals, summary.insights, currency),
    describeTasks(openTasks, currency),
    describeTransactions(recentTransactions, currency),
    describeGoals(goals, currency),
    describeInsights(summary.insights),
    describeReminders(reminders),
    describeNotifications(notifications),
  ]
    .filter(Boolean)
    .join("\n");
}
