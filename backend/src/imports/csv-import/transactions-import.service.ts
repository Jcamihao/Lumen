import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ImportJobStatus, NotificationType, Prisma } from '@prisma/client';
import { LifeEngineService } from '../../life-engine/life-engine.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommitImportDto } from '../dto/commit-import.dto';
import { ParsedRow } from './csv-import.types';
import { parseTransactionsCsv, RawCsvRow } from './csv-rows.parser';

const fingerprintOf = (row: RawCsvRow): string =>
  `${row.type}:${row.description.toLowerCase()}:${row.amount}:${row.date}`;

/** Importacao de lancamentos por CSV: previa com deduplicacao e confirmacao. */
@Injectable()
export class TransactionsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly lifeEngine: LifeEngineService,
  ) {}

  async preview(userId: string, file?: Express.Multer.File) {
    const rows = parseTransactionsCsv(file);
    const previewRows = await this.markDuplicates(userId, rows);
    const duplicates = previewRows.filter((row) => row.duplicate).length;
    const job = await this.prisma.importJob.create({
      data: {
        userId,
        fileName: file!.originalname,
        status: ImportJobStatus.PREVIEWED,
        totalRows: previewRows.length,
        importedRows: 0,
        deduplicatedRows: duplicates,
        previewData: { rows: previewRows } as unknown as Prisma.InputJsonValue,
      },
    });
    return { importJobId: job.id, fileName: job.fileName, totalRows: previewRows.length, duplicates, rows: previewRows };
  }

  private async markDuplicates(userId: string, rows: RawCsvRow[]): Promise<ParsedRow[]> {
    const seenInFile = new Set<string>();
    const result: ParsedRow[] = [];
    for (const row of rows) {
      const fingerprint = fingerprintOf(row);
      const exists = await this.findExisting(userId, row);
      result.push({ ...row, duplicate: seenInFile.has(fingerprint) || !!exists });
      seenInFile.add(fingerprint);
    }
    return result;
  }

  private findExisting(userId: string, row: RawCsvRow) {
    return this.prisma.transaction.findFirst({
      where: {
        userId,
        type: row.type,
        description: row.description,
        amount: new Prisma.Decimal(row.amount),
        date: new Date(row.date),
      },
    });
  }

  async commit(userId: string, dto: CommitImportDto) {
    const job = await this.prisma.importJob.findFirst({ where: { id: dto.importJobId, userId } });
    if (!job) throw new NotFoundException('Importacao nao encontrada.');
    const previewRows = ((job.previewData as any)?.rows ?? []) as ParsedRow[];
    if (previewRows.length === 0) throw new BadRequestException('Nao ha dados de preview para importar.');

    const skipDuplicates = dto.skipDuplicates ?? true;
    let importedRows = 0;
    for (const row of previewRows) {
      if (skipDuplicates && row.duplicate) continue;
      await this.createTransaction(userId, row);
      importedRows += 1;
    }
    await this.prisma.importJob.update({ where: { id: job.id }, data: { status: ImportJobStatus.IMPORTED, importedRows } });
    await this.notifyImported(userId, importedRows);
    return { success: true, importedRows, skippedRows: previewRows.length - importedRows };
  }

  private async createTransaction(userId: string, row: ParsedRow) {
    const category = row.categoryName
      ? await this.prisma.financeCategory.findFirst({ where: { userId, name: row.categoryName, type: row.type } })
      : null;
    await this.prisma.transaction.create({
      data: {
        userId,
        type: row.type,
        description: row.description,
        amount: new Prisma.Decimal(Math.abs(row.amount)),
        date: new Date(row.date),
        categoryId: category?.id,
      },
    });
  }

  private async notifyImported(userId: string, importedRows: number) {
    await this.notifications.createNotification(
      userId,
      NotificationType.IMPORT,
      'Importacao concluida',
      `${importedRows} transacao(oes) foram importadas para o LUMEN.`,
    );
    await this.lifeEngine.touchUserData(userId);
  }
}
