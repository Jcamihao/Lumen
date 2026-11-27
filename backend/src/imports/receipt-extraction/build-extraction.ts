import type { ReceiptExtraction, ReceiptExtractionMethod } from '../receipt-extractor.types';
import type { ParsedReceiptText } from '../receipt-text.parser';

export type ExtractionMeta = {
  method: ReceiptExtractionMethod;
  ocrConfidence: number | null;
  qrDetected: boolean;
  qrCodeText: string | null;
  secondPass: boolean;
};

export function buildExtraction(
  parsed: ParsedReceiptText,
  meta: ExtractionMeta,
): ReceiptExtraction {
  return {
    ...parsed,
    extraction: {
      method: meta.method,
      ocrConfidence: meta.ocrConfidence,
      warnings: [...parsed.warnings],
      qrDetected: meta.qrDetected,
      secondPass: meta.secondPass,
    },
    qrCodeText: meta.qrCodeText,
  };
}
