import { mapFinances } from './finances-section';
import { mapGoals } from './goals-section';
import { mapOnboarding } from './onboarding-section';
import { DashboardSummary } from './dashboard-summary.type';
import { SummarySources } from './summary-sources.type';
import { mapTasks } from './tasks-section';
import { mapUser } from './user-section';

export function buildSummary(sources: SummarySources): DashboardSummary {
  return {
    user: mapUser(sources.user),
    tasks: mapTasks(sources),
    finances: mapFinances(sources),
    goals: mapGoals(sources.goals),
    reminders: sources.reminders,
    insights: sources.insights,
    forecast: sources.forecast,
    notifications: sources.notifications,
    onboarding: mapOnboarding(sources.onboarding),
  };
}
