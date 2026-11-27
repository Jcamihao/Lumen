import { ReceiptExtraction } from '../receipt-extractor.types';
import { documentTypeFromAccessKey } from './receipt-confidence';
import { ExpenseCategoryRef, NormalizedReceiptItem, ReceiptPreviewData } from './receipt-import.types';
import { optionalString } from './text-helpers';

export type DuplicateInfo = {
  possibleDuplicate: boolean;
  transactionId: string | null;
  transactionDescription: string | null;
};

export type PreviewDataInput = {
  extraction: ReceiptExtraction;
  accessKey: string | null;
  items: NormalizedReceiptItem[];
  duplicate: DuplicateInfo;
  suggestedCategory: ExpenseCategoryRef | null;
};

function extractionSummary(extraction: ReceiptExtraction) {
  const { method, ocrConfidence, warnings, qrDetected, secondPass } = extraction.extraction;
  return { method, ocrConfidence, warnings, qrDetected, secondPass };
}

/** Dados guardados junto da leitura (ReceiptScan.previewData). Sem IA: campos de "leitura Selah" vazios. */
export function buildPreviewData(input: PreviewDataInput): ReceiptPreviewData {
  const { extraction, accessKey, items, duplicate, suggestedCategory } = input;
  return {
    notes: extraction.extraction.warnings.slice(0, 12),
    rawTextExcerpt: optionalString(extraction.rawTextRedacted),
    possibleDuplicate: duplicate.possibleDuplicate,
    duplicateTransactionId: duplicate.transactionId,
    duplicateTransactionDescription: duplicate.transactionDescription,
    suggestedCategoryId: suggestedCategory?.id ?? null,
    suggestedCategoryName: suggestedCategory?.name ?? null,
    documentType: documentTypeFromAccessKey(accessKey),
    merchantTaxId: optionalString(extraction.cnpj),
    accessKey,
    accessKeyValid: accessKey !== null,
    qrCodeDetected: extraction.extraction.qrDetected,
    qrCodeText: extraction.qrCodeText,
    itemCategoryHints: items.map((item) => item.categoryHint),
    itemsSum: extraction.itemsSum,
    totalMismatch: extraction.totalMismatch,
    extraction: extractionSummary(extraction),
    purchaseSummary: null,
    purchaseMission: null,
    spendingSignals: [],
    followUpActions: [],
    provider: 'LUMEN_LOCAL',
    model: null,
    generatedAt: new Date().toISOString(),
  };
}
