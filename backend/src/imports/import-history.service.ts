import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const HISTORY_LIMIT = 30;

/** Historico de importacoes (notas fiscais e CSV) do usuario. */
@Injectable()
export class ImportHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listReceiptScans(userId: string) {
    const scans = await this.prisma.receiptScan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        fileName: true,
        merchantName: true,
        totalAmount: true,
        status: true,
        importedAt: true,
        createdAt: true,
      },
    });
    return scans.map((scan) => ({ ...scan, totalAmount: Number(scan.totalAmount) }));
  }

  listImportJobs(userId: string) {
    return this.prisma.importJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        fileName: true,
        status: true,
        totalRows: true,
        importedRows: true,
        deduplicatedRows: true,
        createdAt: true,
      },
    });
  }
}
