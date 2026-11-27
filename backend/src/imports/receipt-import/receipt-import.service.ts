import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { localToday } from '../../recurring-transactions/recurrence.util';
import { sniffMime } from '../../common/utils/file-sniff';
import { PrismaService } from '../../prisma/prisma.service';
import { PreviewReceiptImportDto } from '../dto/preview-receipt-import.dto';
import { ReceiptExtractorService } from '../receipt-extractor.service';
import { ReceiptExtraction } from '../receipt-extractor.types';
import { ReceiptTextItem } from '../receipt-text.parser';
import { suggestExpenseCategory } from './expense-category-suggester';
import { ReceiptDuplicateFinder } from './receipt-duplicate.finder';
import { ensureReceiptFile } from './receipt-file.validation';
import { inferReceiptItemCategory } from './item-category';
import { buildPreviewData, DuplicateInfo } from './preview-data.builder';
import { NormalizedReceiptItem } from './receipt-import.types';
import { ReceiptPreviewSerializer } from './receipt-preview.serializer';
import { buildScanData } from './receipt-scan.data';
import { optionalString } from './text-helpers';

const toNormalizedItems = (items: ReceiptTextItem[]): NormalizedReceiptItem[] =>
  items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    categoryHint: inferReceiptItemCategory(item.description, null),
  }));

/** Le a nota enviada (sem IA), procura duplicata, sugere categoria e grava a previa. */
@Injectable()
export class ReceiptImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: ReceiptExtractorService,
    private readonly duplicates: ReceiptDuplicateFinder,
    private readonly serializer: ReceiptPreviewSerializer,
  ) {}

  async preview(userId: string, file: Express.Multer.File | undefined, dto: PreviewReceiptImportDto) {
    // O usuario escolhe o grupo antes de mandar a foto: falhar aqui evita gastar a leitura (OCR).
    const tagGroup = await this.prisma.tagGroup.findFirst({ where: { id: dto.tagGroupId, userId } });
    if (!tagGroup) {
      throw new NotFoundException('Grupo de tags nao encontrado. Escolha um grupo antes de enviar a nota.');
    }
    ensureReceiptFile(file);
    const extraction = await this.extract(userId, file!);
    const scan = await this.saveScan(userId, file!, tagGroup.id, dto, extraction);
    return this.serializer.serialize(scan);
  }

  private async extract(userId: string, file: Express.Multer.File): Promise<ReceiptExtraction> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    if (!user) throw new NotFoundException('Usuario nao encontrado.');
    return this.extractor.extract({
      buffer: file.buffer,
      mimeType: sniffMime(file.buffer)!,
      fileName: file.originalname,
      today: localToday(new Date(), user.timezone || 'America/Sao_Paulo'),
    });
  }

  private loadExpenseCategories(userId: string) {
    return this.prisma.financeCategory.findMany({
      where: { userId, type: TransactionType.EXPENSE },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    });
  }

  private async findDuplicate(userId: string, extraction: ReceiptExtraction, accessKey: string | null, merchant: string | null) {
    const match = await this.duplicates.findPossibleTransaction(userId, extraction.totalAmount, extraction.purchaseDate, merchant);
    const byKey = accessKey ? await this.duplicates.findImportedByKey(userId, accessKey) : null;
    const found = match ?? byKey?.transaction ?? null;
    const info: DuplicateInfo = {
      possibleDuplicate: !!match || !!byKey,
      transactionId: found?.id ?? null,
      transactionDescription: found?.description ?? null,
    };
    return info;
  }

  private async saveScan(
    userId: string,
    file: Express.Multer.File,
    tagGroupId: string,
    dto: PreviewReceiptImportDto,
    extraction: ReceiptExtraction,
  ) {
    const merchantName = optionalString(extraction.merchantName);
    const items = toNormalizedItems(extraction.items);
    // So chave com digito verificador valido chega aqui; chave invalida vira aviso, nao dado.
    const accessKey = extraction.accessKeyValid ? extraction.accessKey : null;
    const duplicate = await this.findDuplicate(userId, extraction, accessKey, merchantName);
    const categories = await this.loadExpenseCategories(userId);
    const suggestedCategory = suggestExpenseCategory(categories, merchantName, items);
    const previewData = buildPreviewData({ extraction, accessKey, items, duplicate, suggestedCategory });
    return this.prisma.receiptScan.create({
      data: buildScanData({ userId, file, tagGroupId, dto, extraction, merchantName, accessKey, items, previewData }),
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }
}
