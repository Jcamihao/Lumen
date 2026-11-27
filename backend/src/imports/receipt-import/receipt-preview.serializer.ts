import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildReceiptCategoryBreakdown } from './category-breakdown';
import { buildReceiptTransactionDescription } from './item-description';
import { ReceiptPriceHistoryService } from './receipt-price-history.service';
import { ReceiptItemPriceComparison, ReceiptPreviewData } from './receipt-import.types';

export type SerializableReceiptScan = {
  id: string;
  userId: string;
  fileName: string;
  merchantName: string | null;
  purchaseDate: Date | null;
  totalAmount: Prisma.Decimal;
  subtotalAmount: Prisma.Decimal | null;
  taxAmount: Prisma.Decimal | null;
  confidence: string;
  items: Array<{
    id: string;
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal | null;
    totalPrice: Prisma.Decimal;
  }>;
  previewData: Prisma.JsonValue | null;
};

export const readPreviewData = (scan: { previewData: Prisma.JsonValue | null }): ReceiptPreviewData =>
  (scan.previewData || {}) as ReceiptPreviewData;

const optionalNumber = (value: Prisma.Decimal | null): number | null => (value !== null ? Number(value) : null);

@Injectable()
export class ReceiptPreviewSerializer {
  constructor(private readonly priceHistory: ReceiptPriceHistoryService) {}

  async serialize(scan: SerializableReceiptScan) {
    const preview = readPreviewData(scan);
    const numericItems = scan.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: optionalNumber(item.unitPrice),
      totalPrice: Number(item.totalPrice),
    }));
    const comparisons = await this.priceHistory.compareItems(scan.userId, scan.id, numericItems);
    return {
      receiptScanId: scan.id,
      fileName: scan.fileName,
      merchantName: scan.merchantName,
      purchaseDate: scan.purchaseDate?.toISOString() ?? null,
      totalAmount: Number(scan.totalAmount),
      subtotalAmount: optionalNumber(scan.subtotalAmount),
      taxAmount: optionalNumber(scan.taxAmount),
      confidence: scan.confidence,
      ...previewFields(preview),
      categoryBreakdown: buildReceiptCategoryBreakdown(
        scan.items.map((item, i) => ({
          categoryHint: preview.itemCategoryHints?.[i] || null,
          totalPrice: Number(item.totalPrice),
        })),
      ),
      descriptionSuggestion: buildReceiptTransactionDescription(scan.merchantName || 'Compra registrada'),
      items: serializeItems(scan.items, preview, comparisons),
    };
  }
}

function serializeItems(
  items: SerializableReceiptScan['items'],
  preview: ReceiptPreviewData,
  comparisons: Array<ReceiptItemPriceComparison | null>,
) {
  return items.map((item, i) => ({
    id: item.id,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: optionalNumber(item.unitPrice),
    totalPrice: Number(item.totalPrice),
    categoryHint: preview.itemCategoryHints?.[i] || null,
    priceComparison: comparisons[i] || null,
  }));
}

function previewFields(p: ReceiptPreviewData) {
  return {
    itemsSum: p.itemsSum ?? null,
    totalMismatch: p.totalMismatch ?? null,
    extraction: p.extraction ?? null,
    // Nota antiga (sem o campo no previewData) conta como chave nao validada.
    accessKeyValid: p.accessKeyValid === true,
    notes: p.notes || [],
    rawTextExcerpt: p.rawTextExcerpt || null,
    possibleDuplicate: p.possibleDuplicate || false,
    duplicateTransactionId: p.duplicateTransactionId || null,
    duplicateTransactionDescription: p.duplicateTransactionDescription || null,
    suggestedCategoryId: p.suggestedCategoryId || null,
    suggestedCategoryName: p.suggestedCategoryName || null,
    documentType: p.documentType || null,
    merchantTaxId: p.merchantTaxId || null,
    accessKey: p.accessKey || null,
    qrCodeDetected: !!p.qrCodeDetected,
    qrCodeText: p.qrCodeText || null,
    purchaseSummary: p.purchaseSummary || null,
    purchaseMission: p.purchaseMission || null,
    spendingSignals: p.spendingSignals || [],
    followUpActions: p.followUpActions || [],
  };
}
