import type { ForecastsService } from '../../forecasts/forecasts.service';
import type { InsightsService } from '../../insights/insights.service';
import type { findActiveGoals } from '../queries/goals.query';
import type { findUnreadNotifications } from '../queries/notifications.query';
import type { findOnboardingItems } from '../queries/onboarding.query';
import type { findUpcomingReminders } from '../queries/reminders.query';
import type { findRecentTransactions, sumBalanceByType, sumMonthlyTransactions } from '../queries/transactions.query';
import type { countOverdueTasks, findTodayTasks } from '../queries/tasks.query';
import type { findUserProfile } from '../queries/user.query';

/** Resultados brutos das consultas, antes de virar resumo. */
export type SummarySources = {
  user: Awaited<ReturnType<typeof findUserProfile>>;
  todayTasks: Awaited<ReturnType<typeof findTodayTasks>>;
  overdueTasksCount: Awaited<ReturnType<typeof countOverdueTasks>>;
  balanceRows: Awaited<ReturnType<typeof sumBalanceByType>>;
  recentTransactions: Awaited<ReturnType<typeof findRecentTransactions>>;
  monthlyExpenses: Awaited<ReturnType<typeof sumMonthlyTransactions>>;
  monthlyIncome: Awaited<ReturnType<typeof sumMonthlyTransactions>>;
  goals: Awaited<ReturnType<typeof findActiveGoals>>;
  reminders: Awaited<ReturnType<typeof findUpcomingReminders>>;
  notifications: Awaited<ReturnType<typeof findUnreadNotifications>>;
  insights: Awaited<ReturnType<InsightsService['list']>>;
  forecast: Awaited<ReturnType<ForecastsService['getCurrent']>>;
  onboarding: Awaited<ReturnType<typeof findOnboardingItems>>;
};
