import { Prisma, ReceiptScanStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommitItem } from './commit-items';

export type ReceiptCommitInput = {
  userId: string;
  scan: { id: string };
  replaceItems: boolean;
  items: CommitItem[];
  merchantName: string;
  totalAmount: number;
  purchaseDate: Date;
  description: string;
  categoryId?: string;
};

function toItemRows(receiptScanId: string, items: CommitItem[]) {
  return items.map((item, index) => ({
    receiptScanId,
    description: item.description,
    quantity: new Prisma.Decimal(item.quantity),
    unitPrice: item.unitPrice !== null ? new Prisma.Decimal(item.unitPrice) : null,
    totalPrice: new Prisma.Decimal(item.totalPrice),
    sortOrder: index,
  }));
}

type Tx = Prisma.TransactionClient;

function createExpense(tx: Tx, input: ReceiptCommitInput) {
  return tx.transaction.create({
    data: {
      userId: input.userId,
      type: TransactionType.EXPENSE,
      description: input.description,
      amount: new Prisma.Decimal(input.totalAmount),
      date: input.purchaseDate,
      categoryId: input.categoryId,
    },
    include: { category: true, task: true, goal: true },
  });
}

function markScanImported(tx: Tx, input: ReceiptCommitInput, transactionId: string) {
  return tx.receiptScan.update({
    where: { id: input.scan.id },
    data: {
      merchantName: input.merchantName,
      purchaseDate: input.purchaseDate,
      totalAmount: new Prisma.Decimal(input.totalAmount),
      status: ReceiptScanStatus.IMPORTED,
      importedAt: new Date(),
      transactionId,
    },
  });
}

/** Troca os itens editados, cria a despesa e marca a nota como importada, tudo numa transacao. */
export function saveReceiptCommit(prisma: PrismaService, input: ReceiptCommitInput) {
  return prisma.$transaction(async (tx) => {
    if (input.replaceItems) {
      await tx.receiptScanItem.deleteMany({ where: { receiptScanId: input.scan.id } });
      await tx.receiptScanItem.createMany({ data: toItemRows(input.scan.id, input.items) });
    }
    const created = await createExpense(tx, input);
    await markScanImported(tx, input, created.id);
    return created;
  });
}
