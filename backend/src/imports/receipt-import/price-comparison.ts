import {
  PriceableItem,
  ReceiptItemPriceComparison,
  ReceiptItemPriceHistoryEntry,
} from './receipt-import.types';
import { normalizeReceiptItemMatchKey } from './item-description';
import { roundCurrency } from './text-helpers';

export type HistoryEntry = ReceiptItemPriceHistoryEntry & { sortDate: Date };

const MAX_HISTORY_SHOWN = 4;

export function resolveComparableUnitPrice(quantity: number, unitPrice: number | null, totalPrice: number): number | null {
  if (unitPrice !== null && Number.isFinite(unitPrice) && unitPrice >= 0) return unitPrice;
  if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(totalPrice)) return totalPrice / quantity;
  return null;
}

/** Agrupa o historico por produto (chave normalizada), do mais novo para o mais antigo. */
export function groupHistoryByKey(
  rows: Array<{ matchKey: string; entry: HistoryEntry }>,
): Map<string, HistoryEntry[]> {
  const byKey = new Map<string, HistoryEntry[]>();
  for (const { matchKey, entry } of rows) {
    const entries = byKey.get(matchKey) || [];
    entries.push(entry);
    byKey.set(matchKey, entries);
  }
  for (const entries of byKey.values()) {
    entries.sort((left, right) => right.sortDate.getTime() - left.sortDate.getTime());
  }
  return byKey;
}

function percentVsLowest(current: number | null, lowest: number): number | null {
  if (current === null || lowest <= 0) return null;
  return roundCurrency(((current - lowest) / lowest) * 100);
}

function compareItem(item: PriceableItem, matchKey: string, entries: HistoryEntry[]): ReceiptItemPriceComparison {
  const cheapest = entries.reduce((best, current) => (current.unitPrice < best.unitPrice ? current : best));
  const current = resolveComparableUnitPrice(item.quantity, item.unitPrice, item.totalPrice);
  const average = entries.reduce((total, entry) => total + entry.unitPrice, 0) / entries.length;
  return {
    matchKey,
    historyCount: entries.length,
    lowestUnitPrice: roundCurrency(cheapest.unitPrice),
    averageUnitPrice: roundCurrency(average),
    latestUnitPrice: roundCurrency(entries[0].unitPrice),
    cheapestMerchantName: cheapest.merchantName,
    cheapestPurchaseDate: cheapest.purchaseDate,
    currentUnitPrice: current !== null ? roundCurrency(current) : null,
    currentVsLowestAmount: current !== null ? roundCurrency(current - cheapest.unitPrice) : null,
    currentVsLowestPercent: percentVsLowest(current, cheapest.unitPrice),
    history: entries.slice(0, MAX_HISTORY_SHOWN).map(({ sortDate: _sortDate, ...entry }) => ({
      ...entry,
      unitPrice: roundCurrency(entry.unitPrice),
      totalPrice: roundCurrency(entry.totalPrice),
    })),
  };
}

export function compareItemsWithHistory(
  items: PriceableItem[],
  historyByKey: Map<string, HistoryEntry[]>,
): Array<ReceiptItemPriceComparison | null> {
  return items.map((item) => {
    const matchKey = normalizeReceiptItemMatchKey(item.description);
    const entries = historyByKey.get(matchKey) || [];
    return entries.length ? compareItem(item, matchKey, entries) : null;
  });
}
