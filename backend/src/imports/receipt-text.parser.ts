// Porta de entrada do parser puro de texto de nota fiscal. A logica vive em ./receipt-text/,
// um arquivo por responsabilidade. Sem rede, sem banco, sem relogio global: a data de "hoje"
// entra por parametro, e datas sao sempre Date.UTC (meia-noite UTC).
export { parseReceiptText } from './receipt-text/parse-receipt-text';
export { RECEIPT_WARNINGS } from './receipt-text/receipt-warnings';
export { parseBrMoney, parseBrQuantity } from './receipt-text/money';
export { parseBrDate } from './receipt-text/purchase-date';
export { fixNumericOcr } from './receipt-text/ocr-digits';
export { decodeAccessKey, isValidAccessKeyDv, normalizeAccessKey } from './receipt-text/access-key';
export { isValidCnpj } from './receipt-text/cnpj';
export { redactCpf } from './receipt-text/cpf-redaction';
export { extractAccessKeyFromQr, sanitizeQrUrl } from './receipt-text/qr-code';
export type {
  ParsedAccessKey,
  ParsedReceiptText,
  ReceiptTextItem,
  ReceiptTotalMismatch,
} from './receipt-text/receipt-text.types';
