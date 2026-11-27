import { ExportableUser } from "../export-user.query";

export function mapReceiptScans(receiptScans: ExportableUser["receiptScans"]) {
  return receiptScans.map((receiptScan) => ({
    ...receiptScan,
    totalAmount: Number(receiptScan.totalAmount),
    subtotalAmount:
      receiptScan.subtotalAmount !== null ? Number(receiptScan.subtotalAmount) : null,
    taxAmount:
      receiptScan.taxAmount !== null ? Number(receiptScan.taxAmount) : null,
    items: receiptScan.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
      totalPrice: Number(item.totalPrice),
    })),
  }));
}
