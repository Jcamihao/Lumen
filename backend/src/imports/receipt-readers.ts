// Porta de entrada dos leitores de nota (QR, texto de PDF, OCR). A lógica vive em ./receipt-readers/,
// um arquivo por responsabilidade. Os leitores ficam finos: nenhum decide nada sobre a nota.
export { sharp, type SharpPipeline } from './receipt-readers/image/sharp-loader';
export { RECEIPT_MAX_PIXELS } from './receipt-readers/image/receipt-image.limits';
export { decodeQr } from './receipt-readers/qr/qr-decoder';
export { readPdfText } from './receipt-readers/pdf/pdf-text.reader';
export type { PdfJsImporter, PdfJsModule } from './receipt-readers/pdf/pdf-js.types';
export { OcrPool } from './receipt-readers/ocr/ocr-pool';
export { OcrTimeoutError } from './receipt-readers/ocr/ocr-timeout.error';
