import { ReceiptCategoryBreakdownItem } from './receipt-import.types';

const MAX_BREAKDOWN_ITEMS = 6;

export function buildReceiptCategoryBreakdown(
  items: Array<{ categoryHint: string | null; totalPrice: number }>,
): ReceiptCategoryBreakdownItem[] {
  const breakdownMap = new Map<string, ReceiptCategoryBreakdownItem>();
  for (const item of items) {
    const label = item.categoryHint || 'Sem sugestao';
    const current = breakdownMap.get(label) || { label, totalAmount: 0, itemCount: 0 };
    current.totalAmount += Number(item.totalPrice || 0);
    current.itemCount += 1;
    breakdownMap.set(label, current);
  }
  return Array.from(breakdownMap.values())
    .sort((left, right) => right.totalAmount - left.totalAmount)
    .slice(0, MAX_BREAKDOWN_ITEMS)
    .map((item) => ({ ...item, totalAmount: Number(item.totalAmount.toFixed(2)) }));
}
