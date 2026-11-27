import { Injectable } from '@nestjs/common';
import { ReceiptScanStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeReceiptItemMatchKey } from './item-description';
import {
  compareItemsWithHistory,
  groupHistoryByKey,
  HistoryEntry,
  resolveComparableUnitPrice,
} from './price-comparison';
import { PriceableItem, ReceiptItemPriceComparison } from './receipt-import.types';

type HistoricalItem = {
  description: string;
  quantity: unknown;
  unitPrice: unknown;
  totalPrice: unknown;
  receiptScan: { merchantName: string | null; purchaseDate: Date | null; createdAt: Date };
};

function toHistoryRow(item: HistoricalItem): { matchKey: string; entry: HistoryEntry } | null {
  const matchKey = normalizeReceiptItemMatchKey(item.description);
  const unitPrice = resolveComparableUnitPrice(
    Number(item.quantity),
    item.unitPrice !== null ? Number(item.unitPrice) : null,
    Number(item.totalPrice),
  );
  if (!matchKey || unitPrice === null) return null;
  const { receiptScan } = item;
  const entry: HistoryEntry = {
    merchantName: receiptScan.merchantName,
    purchaseDate: receiptScan.purchaseDate?.toISOString() ?? receiptScan.createdAt.toISOString(),
    unitPrice,
    quantity: Number(item.quantity),
    totalPrice: Number(item.totalPrice),
    sortDate: receiptScan.purchaseDate ?? receiptScan.createdAt,
  };
  return { matchKey, entry };
}

/** Busca os itens de notas ja importadas do usuario e compara com os itens da nota atual. */
@Injectable()
export class ReceiptPriceHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async compareItems(
    userId: string,
    receiptScanId: string,
    items: PriceableItem[],
  ): Promise<Array<ReceiptItemPriceComparison | null>> {
    const historicalItems = await this.prisma.receiptScanItem.findMany({
      where: { receiptScan: { userId, status: ReceiptScanStatus.IMPORTED, id: { not: receiptScanId } } },
      select: {
        description: true,
        quantity: true,
        unitPrice: true,
        totalPrice: true,
        receiptScan: { select: { merchantName: true, purchaseDate: true, createdAt: true } },
      },
    });
    const rows = historicalItems.map(toHistoryRow).filter((row) => row !== null);
    return compareItemsWithHistory(items, groupHistoryByKey(rows));
  }
}
