import type { OcrResult } from '../receipt-readers/ocr/ocr.types';

export type ReceiptReaders = {
  decodeQr: (png: Buffer, deadlineMs: number) => Promise<string | null>;
  readPdfText: (buffer: Buffer) => Promise<string>;
  recognize: (png: Buffer, timeoutMs: number) => Promise<OcrResult>;
};
