import { HttpException, HttpStatus } from '@nestjs/common';
import type { ParsedReceiptText } from './receipt-text.parser';

export type ReceiptExtractionMethod = 'PDF_TEXT' | 'OCR';

export type ReceiptExtraction = ParsedReceiptText & {
  extraction: {
    method: ReceiptExtractionMethod;
    ocrConfidence: number | null;
    warnings: string[];
    qrDetected: boolean;
    secondPass: boolean;
  };
  qrCodeText: string | null;
};

export type ReceiptExtractInput = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  today: Date;
};

export const RECEIPT_UNREADABLE_MESSAGE =
  'Não consegui ler esta nota. Lance o gasto pelo chat ("50 mercado") ou pela tela de Finanças.';

export const RECEIPT_TIMEOUT_MESSAGE =
  'A leitura demorou demais. Tente uma foto mais nítida, ou lance o gasto pelo chat ("50 mercado") ou pela tela de Finanças.';

export const RECEIPT_BUSY_MESSAGE = 'Muitas leituras agora, tente em instantes.';

export class ReceiptUnreadableError extends HttpException {
  constructor(message: string = RECEIPT_UNREADABLE_MESSAGE) {
    super(
      { statusCode: HttpStatus.UNPROCESSABLE_ENTITY, code: 'RECEIPT_UNREADABLE', message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ReceiptBusyError extends HttpException {
  constructor() {
    super(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'RECEIPT_BUSY', message: RECEIPT_BUSY_MESSAGE },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
