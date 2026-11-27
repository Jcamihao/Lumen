import { Prisma, ReceiptScanStatus } from '@prisma/client';
import { sniffMime } from '../../common/utils/file-sniff';
import { PreviewReceiptImportDto } from '../dto/preview-receipt-import.dto';
import { ReceiptExtraction } from '../receipt-extractor.types';
import { computeReceiptConfidence } from './receipt-confidence';
import { NormalizedReceiptItem, ReceiptPreviewData } from './receipt-import.types';
import { optionalString } from './text-helpers';

export type ScanDataInput = {
  userId: string;
  file: Express.Multer.File;
  tagGroupId: string;
  dto: PreviewReceiptImportDto;
  extraction: ReceiptExtraction;
  merchantName: string | null;
  accessKey: string | null;
  items: NormalizedReceiptItem[];
  previewData: ReceiptPreviewData;
};

function scanItemsData(items: NormalizedReceiptItem[]) {
  return items.map((item, index) => ({
    description: item.description,
    quantity: new Prisma.Decimal(item.quantity),
    unitPrice: item.unitPrice !== null ? new Prisma.Decimal(item.unitPrice) : undefined,
    totalPrice: new Prisma.Decimal(item.totalPrice),
    sortOrder: index,
  }));
}

/** Dados do ReceiptScan (status PREVIEWED) a partir do que foi lido da nota. */
export function buildScanData(input: ScanDataInput): Prisma.ReceiptScanUncheckedCreateInput {
  const { file, extraction, previewData } = input;
  return {
    userId: input.userId,
    fileName: file.originalname,
    mimeType: sniffMime(file.buffer) ?? file.mimetype,
    status: ReceiptScanStatus.PREVIEWED,
    tagGroupId: input.tagGroupId,
    compareWithPrevious: input.dto.compareWithPrevious ?? false,
    merchantName: input.merchantName,
    documentNumber: optionalString(extraction.documentNumber),
    purchaseDate: extraction.purchaseDate,
    totalAmount: new Prisma.Decimal(extraction.totalAmount),
    currency: 'BRL',
    confidence: computeReceiptConfidence(extraction),
    accessKey: input.accessKey,
    rawText: previewData.rawTextExcerpt,
    previewData: previewData as unknown as Prisma.InputJsonValue,
    items: { create: scanItemsData(input.items) },
  };
}
