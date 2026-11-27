import { PrismaService } from '../../prisma/prisma.service';
import { localToday } from '../../recurring-transactions/recurrence.util';
import { loadCreditCycle } from './credit-cycle-data';
import {
  toCategoryBudgets,
  toCategoryTotals,
  toReceiptSnapshots,
  toRecentExpenses,
  toUpcomingBills,
} from './context-mappers';
import { InsightContext } from './insight-context.types';
import { findImportedReceiptScans } from './receipt-queries';
import {
  aggregateMonthlyExpenses,
  findFinanceCategories,
  findRecentExpenses,
  findRecurringExpenseTemplates,
  groupExpensesByCategory,
} from './spending-queries';
import { findOpenGoals, findOverdueTasks, findRemindersToday, findTasksToday } from './task-queries';
import { buildTimeWindows, TimeWindows } from './time-windows';

async function readTaskSources(prisma: PrismaService, userId: string, w: TimeWindows) {
  const [overdueTasks, tasksToday, goals, remindersToday] = await Promise.all([
    findOverdueTasks(prisma, userId, w),
    findTasksToday(prisma, userId, w),
    findOpenGoals(prisma, userId),
    findRemindersToday(prisma, userId, w),
  ]);
  return { overdueTasks, tasksToday, goals, remindersToday };
}

async function readSpendingSources(prisma: PrismaService, userId: string, w: TimeWindows) {
  const [monthlyAggregate, recentExpenses, currentGroups, previousGroups, financeCategories, templates] =
    await Promise.all([
      aggregateMonthlyExpenses(prisma, userId, w),
      findRecentExpenses(prisma, userId, w),
      groupExpensesByCategory(prisma, userId, w.currentMonthStartUtc, w.now),
      groupExpensesByCategory(prisma, userId, w.previousMonthStart, w.previousMonthEnd),
      findFinanceCategories(prisma, userId),
      findRecurringExpenseTemplates(prisma, userId, w),
    ]);
  return { monthlyAggregate, recentExpenses, currentGroups, previousGroups, financeCategories, templates };
}

const previousMonthName = (previousMonthStart: Date): string =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(previousMonthStart);

/** Le do banco tudo o que os detectores precisam e entrega normalizado (numeros, datas, nomes). */
export async function loadInsightContext(prisma: PrismaService, userId: string): Promise<InsightContext> {
  const w = buildTimeWindows(new Date());
  const [user, tasks, spending, receiptScans] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    readTaskSources(prisma, userId, w),
    readSpendingSources(prisma, userId, w),
    findImportedReceiptScans(prisma, userId),
  ]);
  const userToday = localToday(w.now, user.timezone ?? 'UTC');
  const creditCycle = await loadCreditCycle(prisma, userId, userToday);
  const categoryNames = new Map((spending.financeCategories ?? []).map((category) => [category.id, category.name]));

  return {
    now: w.now,
    user,
    ...tasks,
    monthlyExpenses: Number(spending.monthlyAggregate._sum.amount ?? 0),
    monthlyIncome: Number(user.monthlyIncome ?? 0),
    upcomingBills: toUpcomingBills(spending.templates, userToday),
    creditCycle,
    categoryBudgets: toCategoryBudgets(spending.financeCategories),
    categorySpending: {
      current: toCategoryTotals(spending.currentGroups, categoryNames),
      previous: toCategoryTotals(spending.previousGroups, categoryNames),
      previousMonthLabel: previousMonthName(w.previousMonthStart),
    },
    recentExpenses: toRecentExpenses(spending.recentExpenses),
    recentReceiptScans: toReceiptSnapshots(receiptScans),
  };
}
