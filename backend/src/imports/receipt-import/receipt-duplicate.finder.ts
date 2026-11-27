import { Injectable } from '@nestjs/common';
import { Prisma, ReceiptScanStatus, TransactionType } from '@prisma/client';
import { endOfDay, startOfDay } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';

/** Procura lancamentos e notas que parecem ser a mesma compra. Toda busca leva o userId. */
@Injectable()
export class ReceiptDuplicateFinder {
  constructor(private readonly prisma: PrismaService) {}

  findPossibleTransaction(
    userId: string,
    totalAmount: number,
    purchaseDate: Date | null,
    merchantName: string | null,
  ) {
    return this.prisma.transaction.findFirst({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        amount: new Prisma.Decimal(totalAmount),
        date: purchaseDate ? { gte: startOfDay(purchaseDate), lte: endOfDay(purchaseDate) } : undefined,
        description: merchantName ? { contains: merchantName, mode: 'insensitive' } : undefined,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, description: true },
    });
  }

  findImportedByKey(userId: string, accessKey: string) {
    return this.prisma.receiptScan.findFirst({
      where: { userId, accessKey, status: ReceiptScanStatus.IMPORTED },
      include: { transaction: true },
    });
  }

  async hasOtherImportedWithKey(userId: string, accessKey: string, excludeId: string): Promise<boolean> {
    const found = await this.prisma.receiptScan.findFirst({
      where: { userId, accessKey, status: ReceiptScanStatus.IMPORTED, id: { not: excludeId } },
      select: { id: true },
    });
    return found !== null;
  }
}
