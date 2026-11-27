import { Prisma } from '@prisma/client';
import { CommitReceiptImportItemDto } from '../dto/commit-receipt-import.dto';

type StoredItem = {
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  totalPrice: Prisma.Decimal;
};

export type CommitItem = {
  description: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
};

function fromStored(items: StoredItem[]): CommitItem[] {
  return items.map((item) => ({
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
    totalPrice: Number(item.totalPrice),
  }));
}

function fromDto(items: CommitReceiptImportItemDto[]): CommitItem[] {
  return items
    .map((item) => ({
      description: item.description.trim(),
      quantity: Math.max(0.001, Number(item.quantity || 1)),
      unitPrice:
        item.unitPrice === null || item.unitPrice === undefined ? null : Math.max(0, Number(item.unitPrice)),
      totalPrice: Math.max(0, Number(item.totalPrice || 0)),
    }))
    .filter((item) => !!item.description);
}

/** Itens editados pelo usuario; sem edicao, os itens ja lidos da nota. */
export function normalizeCommitItems(
  items: CommitReceiptImportItemDto[] | undefined,
  fallbackItems: StoredItem[],
): CommitItem[] {
  return items?.length ? fromDto(items) : fromStored(fallbackItems);
}
