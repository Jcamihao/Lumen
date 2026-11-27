import type { SummarySources } from './summary-sources.type';

type TodayTask = SummarySources['todayTasks']['items'][number];
type RecentTransaction = SummarySources['recentTransactions'][number];
type Goal = SummarySources['goals'][number];

export interface DashboardSummary {
  user: Omit<SummarySources['user'], 'monthlyIncome'> & { monthlyIncome: number };
  tasks: {
    todayCount: number;
    overdueCount: number;
    items: Array<Omit<TodayTask, 'estimatedAmount'> & { estimatedAmount: number | null }>;
  };
  finances: {
    balance: number;
    monthlyExpenses: number;
    monthlyIncome: number;
    recentTransactions: Array<Omit<RecentTransaction, 'amount'> & { amount: number }>;
  };
  goals: Array<Omit<Goal, 'targetAmount' | 'currentAmount'> & { targetAmount: number | null; currentAmount: number }>;
  reminders: SummarySources['reminders'];
  insights: SummarySources['insights'];
  forecast: SummarySources['forecast'];
  notifications: SummarySources['notifications'];
  onboarding: {
    tasks: boolean;
    transactions: boolean;
    goals: boolean;
    recurring: boolean;
    selah: boolean;
  };
}
