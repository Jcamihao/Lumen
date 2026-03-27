import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImportJobStatus, NotificationType, Prisma, TransactionType } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommitImportDto } from './dto/commit-import.dto';

type ParsedRow = {
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  categoryName?: string;
  duplicate: boolean;
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async previewTransactionsImport(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Envie um arquivo CSV no campo file.');
    }

    const rows = parse(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (rows.length === 0) {
      throw new BadRequestException('O arquivo CSV esta vazio.');
    }

    const normalizedRows = rows.map((rawRow: Record<string, string>) =>
      Object.entries(rawRow).reduce<Record<string, string>>((accumulator, [key, value]) => {
        accumulator[key.trim().toLowerCase()] = value;
        return accumulator;
      }, {}),
    );

    const previewRows: ParsedRow[] = [];
    const seenInFile = new Set<string>();

    for (const row of normalizedRows) {
      const type = this.normalizeType(row.type ?? row.tipo);
      const description = row.description ?? row.descricao;
      const amount = Number(String(row.amount ?? row.valor ?? '0').replace(',', '.'));
      const date = row.date ?? row.data;
      const categoryName = row.category ?? row.categoria;

      if (!type || !description || Number.isNaN(amount) || !date) {
        throw new BadRequestException(
          'Cada linha do CSV precisa ter tipo, descricao, valor e data.',
        );
      }

      const fingerprint = `${type}:${description.toLowerCase()}:${amount}:${date}`;
      const exists = await this.prisma.transaction.findFirst({
        where: {
          userId,
          type,
          description,
          amount: new Prisma.Decimal(amount),
          date: new Date(date),
        },
      });
      const duplicate = seenInFile.has(fingerprint) || !!exists;
      seenInFile.add(fingerprint);

      previewRows.push({
        type,
        description,
        amount,
        date,
        categoryName,
        duplicate,
      });
    }

    const importJob = await this.prisma.importJob.create({
      data: {
        userId,
        fileName: file.originalname,
        status: ImportJobStatus.PREVIEWED,
        totalRows: previewRows.length,
        importedRows: 0,
        deduplicatedRows: previewRows.filter((row) => row.duplicate).length,
        previewData: {
          rows: previewRows,
        },
      },
    });

    return {
      importJobId: importJob.id,
      fileName: importJob.fileName,
      totalRows: previewRows.length,
      duplicates: previewRows.filter((row) => row.duplicate).length,
      rows: previewRows,
    };
  }

  async commitTransactionsImport(userId: string, dto: CommitImportDto) {
    const importJob = await this.prisma.importJob.findFirst({
      where: {
        id: dto.importJobId,
        userId,
      },
    });

    if (!importJob) {
      throw new NotFoundException('Importacao nao encontrada.');
    }

    const previewRows = ((importJob.previewData as any)?.rows ?? []) as ParsedRow[];

    if (previewRows.length === 0) {
      throw new BadRequestException('Nao ha dados de preview para importar.');
    }

    const shouldSkipDuplicates = dto.skipDuplicates ?? true;
    let importedRows = 0;

    for (const row of previewRows) {
      if (shouldSkipDuplicates && row.duplicate) {
        continue;
      }

      const category = row.categoryName
        ? await this.prisma.financeCategory.findFirst({
            where: {
              userId,
              name: row.categoryName,
              type: row.type,
            },
          })
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
      importedRows += 1;
    }

    await this.prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: ImportJobStatus.IMPORTED,
        importedRows,
      },
    });

    await this.notificationsService.createNotification(
      userId,
      NotificationType.IMPORT,
      'Importacao concluida',
      `${importedRows} transacao(oes) foram importadas para o LUMEN.`,
    );
    await this.lifeEngineService.touchUserData(userId);

    return {
      success: true,
      importedRows,
      skippedRows: previewRows.length - importedRows,
    };
  }

  private normalizeType(value?: string): TransactionType | null {
    const normalized = value?.trim().toUpperCase();

    if (!normalized) {
      return null;
    }

    if (normalized === 'INCOME' || normalized === 'RECEITA') {
      return TransactionType.INCOME;
    }

    if (normalized === 'EXPENSE' || normalized === 'DESPESA') {
      return TransactionType.EXPENSE;
    }

    if (normalized === 'TRANSFER' || normalized === 'TRANSFERENCIA') {
      return TransactionType.TRANSFER;
    }

    return null;
  }
}
