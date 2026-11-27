import { addDaysUtc } from '../../recurring-transactions/recurrence.util';
import { CategoryTotal, ChargeOccurrence, ReceiptScanSnapshot } from '../insight.types';
import { UPCOMING_BILL_WINDOW_DAYS } from './context-limits';
import { InsightContext, UpcomingBill } from './insight-context.types';

const DAY_MS = 86_400_000;

/** Contas fixas que vencem depois de hoje e ate o fim da janela, com os dias que faltam. */
export function toUpcomingBills(
  templates: Array<{ id: string; description: string; amount: unknown; nextDueDate: Date }> | undefined,
  userToday: Date,
): UpcomingBill[] {
  const windowEnd = addDaysUtc(userToday, UPCOMING_BILL_WINDOW_DAYS);
  return (templates ?? [])
    .map((bill) => ({
      id: bill.id,
      description: bill.description,
      amount: Number(bill.amount),
      dueDate: new Date(bill.nextDueDate),
    }))
    .filter((bill) => bill.dueDate > userToday && bill.dueDate <= windowEnd)
    .map((bill) => ({
      ...bill,
      daysUntil: Math.round((bill.dueDate.getTime() - userToday.getTime()) / DAY_MS),
    }));
}

export function toCategoryTotals(groups: any[] | undefined, categoryNames: Map<string, string>): CategoryTotal[] {
  return (groups ?? []).map((group) => ({
    categoryId: group.categoryId ?? null,
    name: group.categoryId ? (categoryNames.get(group.categoryId) ?? 'Categoria removida') : 'Sem categoria',
    total: Number(group._sum?.amount ?? 0),
    count: Number(group._count?._all ?? 0),
  }));
}

export function toCategoryBudgets(
  categories: Array<{ id: string; name: string; monthlyBudget: unknown }> | undefined,
): InsightContext['categoryBudgets'] {
  return (categories ?? [])
    .filter((category) => category.monthlyBudget !== null && category.monthlyBudget !== undefined)
    .map((category) => ({ categoryId: category.id, name: category.name, budget: Number(category.monthlyBudget) }))
    .filter((category) => category.budget > 0);
}

export function toRecentExpenses(
  expenses: Array<{ id: string; description: string; amount: unknown; date: Date }> | undefined,
): ChargeOccurrence[] {
  return (expenses ?? []).map((expense) => ({
    id: expense.id,
    description: expense.description,
    amount: Number(expense.amount),
    date: new Date(expense.date),
  }));
}

export function toReceiptSnapshots(scans: any[] | undefined): ReceiptScanSnapshot[] {
  return (scans ?? [])
    .filter((scan) => !!scan.tagGroupId)
    .map((scan) => ({
      id: scan.id,
      merchantName: (scan.merchantName ?? '').trim(),
      purchaseDate: new Date(scan.purchaseDate ?? new Date()),
      totalAmount: Number(scan.totalAmount),
      tagGroupId: scan.tagGroupId as string,
      tagGroupName: scan.tagGroup?.name ?? 'Grupo removido',
      compareWithPrevious: scan.compareWithPrevious,
      items: scan.items.map((item: any) => ({
        description: item.description,
        totalPrice: Number(item.totalPrice),
      })),
    }));
}
