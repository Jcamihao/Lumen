import { toNullableNumber } from './number';
import { DashboardSummary } from './dashboard-summary.type';
import { SummarySources } from './summary-sources.type';

export function mapGoals(goals: SummarySources['goals']): DashboardSummary['goals'] {
  return goals.map((goal) => ({
    ...goal,
    targetAmount: toNullableNumber(goal.targetAmount),
    currentAmount: Number(goal.currentAmount),
  }));
}
