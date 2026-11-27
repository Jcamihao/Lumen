import { ReceiptItemSnapshot, ReceiptScanSnapshot } from '../insight.types';

type PricedItem = { description: string; price: number };
type PriceChange = { description: string; previousPrice: number; currentPrice: number };

export type ReceiptComparison = {
  tagGroupId: string;
  tagGroupName: string;
  currentMerchant: string | null;
  previousMerchant: string | null;
  previousTotal: number;
  currentTotal: number;
  deltaAmount: number;
  deltaPercent: number | null;
  topIncrease: PriceChange | null;
  topDecrease: PriceChange | null;
  itemsAdded: string[];
  itemsRemoved: string[];
};

/** Soma o valor de itens repetidos na mesma nota antes de comparar entre notas. */
function sumItemsByDescription(items: ReceiptItemSnapshot[]): Map<string, PricedItem> {
  const map = new Map<string, PricedItem>();
  for (const item of items) {
    const key = item.description.trim().toLowerCase();
    const existing = map.get(key);
    map.set(key, { description: item.description, price: (existing?.price ?? 0) + item.totalPrice });
  }
  return map;
}

/** Maior alta e maior queda de preco entre os itens que existem nas duas notas. */
function findPriceChanges(currentItems: Map<string, PricedItem>, previousItems: Map<string, PricedItem>) {
  let topIncrease: PriceChange | null = null;
  let topDecrease: PriceChange | null = null;

  for (const [normalizedDescription, currentPrice] of currentItems) {
    const previousPrice = previousItems.get(normalizedDescription);
    if (previousPrice === undefined) continue;

    const delta = currentPrice.price - previousPrice.price;
    const change = {
      description: currentPrice.description,
      previousPrice: previousPrice.price,
      currentPrice: currentPrice.price,
    };
    if (delta > 0 && (!topIncrease || delta > topIncrease.currentPrice - topIncrease.previousPrice)) {
      topIncrease = change;
    }
    if (delta < 0 && (!topDecrease || delta < topDecrease.currentPrice - topDecrease.previousPrice)) {
      topDecrease = change;
    }
  }
  return { topIncrease, topDecrease };
}

const descriptionsMissingFrom = (from: Map<string, PricedItem>, other: Map<string, PricedItem>): string[] =>
  [...from.keys()].filter((key) => !other.has(key)).map((key) => from.get(key)!.description);

/** Compara duas notas do mesmo grupo de tags, item a item. */
export function compareReceipts(current: ReceiptScanSnapshot, previous: ReceiptScanSnapshot): ReceiptComparison {
  const previousItems = sumItemsByDescription(previous.items);
  const currentItems = sumItemsByDescription(current.items);
  const { topIncrease, topDecrease } = findPriceChanges(currentItems, previousItems);
  const deltaAmount = current.totalAmount - previous.totalAmount;

  return {
    tagGroupId: current.tagGroupId,
    tagGroupName: current.tagGroupName,
    currentMerchant: current.merchantName || null,
    previousMerchant: previous.merchantName || null,
    previousTotal: previous.totalAmount,
    currentTotal: current.totalAmount,
    deltaAmount,
    deltaPercent: previous.totalAmount > 0 ? deltaAmount / previous.totalAmount : null,
    topIncrease,
    topDecrease,
    itemsAdded: descriptionsMissingFrom(currentItems, previousItems),
    itemsRemoved: descriptionsMissingFrom(previousItems, currentItems),
  };
}
