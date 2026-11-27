import { DashboardSummary } from '../../assistant.types';

export function criticalInsightsOf(summary: DashboardSummary) {
  return summary.insights.filter((insight) => insight.severity === "CRITICAL");
}

export function nextTasksOf(summary: DashboardSummary) {
  return summary.tasks.items.slice(0, 3);
}

export function goalsOf(summary: DashboardSummary) {
  return summary.goals.slice(0, 2);
}
