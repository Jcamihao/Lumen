import { ReceiptScanStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RECEIPT_SCAN_MAX_ROWS } from './context-limits';

export function findImportedReceiptScans(prisma: PrismaService, userId: string) {
  return prisma.receiptScan.findMany({
    where: {
      userId,
      status: ReceiptScanStatus.IMPORTED,
      // So participa da comparacao quem tem grupo — e o grupo, nao mais o
      // nome do estabelecimento, que define o que e comparavel com o que.
      tagGroupId: { not: null },
    },
    select: {
      id: true,
      merchantName: true,
      purchaseDate: true,
      totalAmount: true,
      tagGroupId: true,
      compareWithPrevious: true,
      tagGroup: { select: { name: true } },
      items: { select: { description: true, totalPrice: true } },
    },
    orderBy: { purchaseDate: 'desc' },
    take: RECEIPT_SCAN_MAX_ROWS,
  });
}
