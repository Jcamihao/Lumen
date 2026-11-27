import { ReceiptUnreadableError, RECEIPT_TIMEOUT_MESSAGE } from '../receipt-extractor.types';
import { OcrTimeoutError } from '../receipt-readers/ocr/ocr-timeout.error';
import type { OcrResult } from '../receipt-readers/ocr/ocr.types';
import { parseReceiptText, ParsedReceiptText } from '../receipt-text.parser';
import { ReceiptReaders } from './extraction-readers.type';

export type OcrPass = { parsed: ParsedReceiptText; confidence: number };

export type OcrContext = {
  qrAccessKey: string | null;
  today: Date;
  deadline: number;
};

/** Uma passada de OCR: o tempo que falta até o prazo vira o limite desta leitura. */
export async function runOcr(
  readers: ReceiptReaders,
  png: Buffer,
  context: OcrContext,
): Promise<OcrPass> {
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) {
    throw new ReceiptUnreadableError(RECEIPT_TIMEOUT_MESSAGE);
  }

  const result = await recognizeOrFail(readers, png, remaining);
  return {
    parsed: parseReceiptText(result.text, {
      today: context.today,
      qrAccessKey: context.qrAccessKey,
    }),
    confidence: result.confidence / 100,
  };
}

async function recognizeOrFail(
  readers: ReceiptReaders,
  png: Buffer,
  timeoutMs: number,
): Promise<OcrResult> {
  try {
    return await readers.recognize(png, timeoutMs);
  } catch (error) {
    if (error instanceof OcrTimeoutError) {
      throw new ReceiptUnreadableError(RECEIPT_TIMEOUT_MESSAGE);
    }
    throw new ReceiptUnreadableError();
  }
}
