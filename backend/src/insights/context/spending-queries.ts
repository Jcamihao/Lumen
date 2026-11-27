import { PrismaService } from '../../prisma/prisma.service';
import { addDaysUtc } from '../../recurring-transactions/recurrence.util';
import { subDays } from 'date-fns';
import { CHARGE_WINDOW_DAYS, CHARGE_WINDOW_MAX_ROWS, UPCOMING_BILL_WINDOW_DAYS } from './context-limits';
import { TimeWindows } from './time-windows';

export function aggregateMonthlyExpenses(prisma: PrismaService, userId: string, w: TimeWindows) {
  return prisma.transaction.aggregate({
    where: { userId, type: 'EXPENSE', date: { gte: w.monthStart, lte: w.now } },
    _sum: { amount: true },
  });
}

export function findRecentExpenses(prisma: PrismaService, userId: string, w: TimeWindows) {
  return prisma.transaction.findMany({
    where: {
      userId,
      type: 'EXPENSE',
      // Lancamento gerado por conta fixa ja e conhecido pelo usuario: nao
      // deve virar "identifiquei uma cobranca recorrente".
      recurringTransactionId: null,
      date: { gte: subDays(w.todayStart, CHARGE_WINDOW_DAYS), lte: w.todayEnd },
    },
    select: { id: true, description: true, amount: true, date: true },
    orderBy: { date: 'desc' },
    take: CHARGE_WINDOW_MAX_ROWS,
  });
}

export function groupExpensesByCategory(prisma: PrismaService, userId: string, from: Date, to: Date) {
  return prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { userId, type: 'EXPENSE', date: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: { _all: true },
  });
}

export function findFinanceCategories(prisma: PrismaService, userId: string) {
  return prisma.financeCategory.findMany({
    where: { userId },
    select: { id: true, name: true, monthlyBudget: true },
  });
}

// Janela larga em UTC; o corte exato usa o "hoje" do fuso do usuario depois.
export function findRecurringExpenseTemplates(prisma: PrismaService, userId: string, w: TimeWindows) {
  return prisma.recurringTransaction.findMany({
    where: {
      userId,
      isActive: true,
      type: 'EXPENSE',
      nextDueDate: { gte: addDaysUtc(w.now, -2), lte: addDaysUtc(w.now, UPCOMING_BILL_WINDOW_DAYS + 2) },
    },
    select: { id: true, description: true, amount: true, nextDueDate: true },
    orderBy: { nextDueDate: 'asc' },
  });
}
