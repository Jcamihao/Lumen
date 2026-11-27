import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, ReceiptScanStatus, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../../life-engine/life-engine.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CommitReceiptImportDto } from '../dto/commit-receipt-import.dto';
import { normalizeCommitItems } from './commit-items';
import { saveReceiptCommit } from './receipt-commit.persistence';
import { buildReceiptTransactionDescription } from './item-description';
import { ReceiptDuplicateFinder } from './receipt-duplicate.finder';
import { readPreviewData } from './receipt-preview.serializer';
import { toDateOrNull } from './text-helpers';

type ScanWithItems = NonNullable<Awaited<ReturnType<ReceiptCommitService['findScan']>>>;

/** Confirma a nota lida: cria a despesa, troca os itens editados e marca a nota como importada. */
@Injectable()
export class ReceiptCommitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngine: LifeEngineService,
    private readonly notifications: NotificationsService,
    private readonly duplicates: ReceiptDuplicateFinder,
  ) {}

  async commit(userId: string, dto: CommitReceiptImportDto) {
    const scan = await this.findScan(userId, dto.receiptScanId);
    if (!scan) throw new NotFoundException('Leitura da nota fiscal nao encontrada.');
    if (scan.status === ReceiptScanStatus.IMPORTED && scan.transactionId) {
      throw new BadRequestException('Esta nota fiscal ja foi importada.');
    }
    await this.ensureDuplicateDecided(userId, scan, dto);
    const categoryId = dto.categoryId || readPreviewData(scan).suggestedCategoryId || undefined;
    if (categoryId) await this.ensureExpenseCategory(userId, categoryId);
    return this.persist(userId, scan, dto, categoryId);
  }

  private findScan(userId: string, receiptScanId: string) {
    return this.prisma.receiptScan.findFirst({
      where: { id: receiptScanId, userId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // Duplicata e aviso, nao unicidade: duas confirmacoes simultaneas de notas diferentes com a
  // mesma chave podem passar (limite conhecido, registrado no HANDOFF).
  private async ensureDuplicateDecided(userId: string, scan: ScanWithItems, dto: CommitReceiptImportDto) {
    if (dto.acknowledgeDuplicate === true) return;
    const keyAlreadyImported = scan.accessKey
      ? await this.duplicates.hasOtherImportedWithKey(userId, scan.accessKey, scan.id)
      : false;
    if (readPreviewData(scan).possibleDuplicate || keyAlreadyImported) {
      throw new ConflictException({
        statusCode: 409,
        code: 'RECEIPT_DUPLICATE_UNCONFIRMED',
        message: 'Parece que você já lançou esta compra. Confirme para importar mesmo assim.',
      });
    }
  }

  private async ensureExpenseCategory(userId: string, categoryId: string) {
    const category = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, userId, type: TransactionType.EXPENSE },
    });
    if (!category) throw new NotFoundException('Categoria financeira invalida para importacao de nota.');
  }

  private async persist(userId: string, scan: ScanWithItems, dto: CommitReceiptImportDto, categoryId?: string) {
    const merchantName = dto.merchantName?.trim() || scan.merchantName || 'Compra registrada';
    const totalAmount =
      dto.totalAmount !== undefined ? Math.abs(Number(dto.totalAmount)) : Number(scan.totalAmount);
    const purchaseDate = toDateOrNull(dto.purchaseDate) ?? scan.purchaseDate ?? new Date();
    const description = dto.description?.trim() || buildReceiptTransactionDescription(merchantName);
    const items = normalizeCommitItems(dto.items, scan.items);
    const transaction = await saveReceiptCommit(this.prisma, {
      userId, scan, replaceItems: !!dto.items?.length, items, merchantName, totalAmount, purchaseDate, description, categoryId,
    });
    await this.notifyImported(userId, description, items.length);
    return {
      success: true,
      receiptScanId: scan.id,
      importedItems: items.length,
      transaction: { ...transaction, amount: Number(transaction.amount) },
    };
  }

  private async notifyImported(userId: string, description: string, itemCount: number) {
    await this.notifications.createNotification(
      userId,
      NotificationType.IMPORT,
      'Nota fiscal registrada',
      `${description} foi registrada com ${itemCount} item(ns) no LUMEN.`,
    );
    await this.lifeEngine.touchUserData(userId);
  }
}
