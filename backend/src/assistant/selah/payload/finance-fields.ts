import { DashboardSummary } from '../../assistant.types';

export function financeFields(summary: DashboardSummary) {
  return {
    currentBalance: summary.finances.balance,
    monthlyExpenses: summary.finances.monthlyExpenses,
    monthlyIncome: summary.finances.monthlyIncome,
    forecast: {
      predictedBalance: Number(summary.forecast.predictedBalance ?? 0),
      riskLevel: String(summary.forecast.riskLevel || "MEDIUM"),
    },
  };
}
