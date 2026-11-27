import { ReceiptExtraction } from '../receipt-extractor.types';
import { decodeAccessKey } from '../receipt-text.parser';

/** Alta so com chave valida e soma batendo; baixa com divergencia ou linha de item que nao fecha. */
export function computeReceiptConfidence(extraction: ReceiptExtraction): 'low' | 'medium' | 'high' {
  if (
    extraction.totalMismatch ||
    extraction.items.length === 0 ||
    extraction.items.some((item) => !item.lineConsistent)
  ) {
    return 'low';
  }
  if (
    extraction.accessKeyValid &&
    extraction.itemsSum !== null &&
    extraction.extraction.warnings.length === 0
  ) {
    return 'high';
  }
  return 'medium';
}

export function documentTypeFromAccessKey(accessKey: string | null): 'nfce' | null {
  if (!accessKey) return null;
  // Modelo 65 na chave = NFC-e.
  return decodeAccessKey(accessKey)?.model === '65' ? 'nfce' : null;
}
