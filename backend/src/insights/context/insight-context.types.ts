import { Task, Goal, Reminder, User } from '@prisma/client';
import { CategoryTotal, ChargeOccurrence, ReceiptScanSnapshot } from '../insight.types';

export type UpcomingBill = {
  id: string;
  description: string;
  amount: number;
  dueDate: Date;
  daysUntil: number;
};

/** Tudo o que os detectores precisam saber do usuario, ja lido e normalizado. */
export type InsightContext = {
  now: Date;
  user: User;
  overdueTasks: Task[];
  tasksToday: Task[];
  goals: Goal[];
  remindersToday: Reminder[];
  monthlyExpenses: number;
  monthlyIncome: number;
  upcomingBills: UpcomingBill[];
  creditCycle: {
    closingDate: Date;
    dueDay: number | null;
    ceiling: number | null;
    spent: number;
  };
  categoryBudgets: Array<{ categoryId: string; name: string; budget: number }>;
  categorySpending: {
    current: CategoryTotal[];
    previous: CategoryTotal[];
    previousMonthLabel: string;
  };
  recentExpenses: ChargeOccurrence[];
  recentReceiptScans: ReceiptScanSnapshot[];
};
