import { DashboardSummary } from './dashboard-summary.type';
import { SummarySources } from './summary-sources.type';

export function mapOnboarding(items: SummarySources['onboarding']): DashboardSummary['onboarding'] {
  return {
    tasks: Boolean(items.firstTask),
    transactions: Boolean(items.firstManualTransaction),
    goals: Boolean(items.firstGoal),
    recurring: Boolean(items.firstRecurring),
    selah: Boolean(items.firstAssistantTurn),
  };
}
