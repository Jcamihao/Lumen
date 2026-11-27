import { BadRequestException } from '@nestjs/common';
import {
  ReceiptExtraction,
  ReceiptExtractInput,
  ReceiptUnreadableError,
} from '../receipt-extractor.types';
import { parseReceiptText } from '../receipt-text.parser';
import { buildExtraction } from './build-extraction';
import { PDF_MIN_TEXT_CHARS } from './extraction-limits';
import { PDF_SCANNED_MESSAGE } from './extraction-messages';
import { ReceiptReaders } from './extraction-readers.type';

/** Nota em PDF com camada de texto: não passa por OCR nem por QR. */
export async function extractReceiptFromPdf(
  input: ReceiptExtractInput,
  readers: ReceiptReaders,
): Promise<ReceiptExtraction> {
  const text = await readPdfTextOrFail(input.buffer, readers);
  ensureEnoughPdfText(text);

  const parsed = parseReceiptText(text, { today: input.today });
  return buildExtraction(parsed, {
    method: 'PDF_TEXT',
    ocrConfidence: null,
    qrDetected: false,
    qrCodeText: null,
    secondPass: false,
  });
}

async function readPdfTextOrFail(buffer: Buffer, readers: ReceiptReaders): Promise<string> {
  try {
    return await readers.readPdfText(buffer);
  } catch {
    throw new ReceiptUnreadableError();
  }
}

function ensureEnoughPdfText(text: string) {
  const meaningful = text.replace(/[^\p{L}\p{N}]/gu, '');
  if (meaningful.length < PDF_MIN_TEXT_CHARS) {
    throw new BadRequestException(PDF_SCANNED_MESSAGE);
  }
}
