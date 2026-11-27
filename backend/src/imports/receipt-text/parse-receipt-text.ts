import { decodeAccessKey, findTextKey, normalizeAccessKey, usableKey } from './access-key';
import { resolveCnpj } from './cnpj';
import { resolveDocumentNumber } from './document-number';
import { findMerchantName } from './merchant-name';
import { dateDiffersFromKey, findDateText, parseBrDate } from './purchase-date';
import { ExtractedItems, extractItems } from './receipt-items';
import { chooseTotal, findTotalMismatch } from './receipt-total';
import { ParsedAccessKey, ParsedReceiptText, ParseReceiptOptions } from './receipt-text.types';
import { orderWarnings, RECEIPT_WARNINGS, WarningKey } from './receipt-warnings';
import { normalizeSource, redactedExcerpt, splitLines } from './text-normalization';

const sumOrNull = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;

const centsToMoney = (cents: number | null): number | null => (cents === null ? null : cents / 100);

function emptyResult(): ParsedReceiptText {
  return {
    merchantName: null,
    cnpj: null,
    cnpjSource: null,
    accessKey: null,
    accessKeyValid: false,
    documentNumber: null,
    purchaseDate: null,
    totalAmount: null,
    items: [],
    itemsSum: null,
    totalMismatch: null,
    warnings: [RECEIPT_WARNINGS.W_DATE_INVALID, RECEIPT_WARNINGS.W_NO_ITEMS, RECEIPT_WARNINGS.W_NO_TOTAL],
    rawTextRedacted: '',
  };
}

function resolveAccessKey(lines: string[], options: ParseReceiptOptions, flags: Set<WarningKey>) {
  // Chave: QR vence o texto; so vale com DV e mes validos.
  const textKey = findTextKey(lines);
  const qrKey = options.qrAccessKey ? usableKey(normalizeAccessKey(options.qrAccessKey)) : null;
  if (qrKey && textKey && qrKey !== textKey) flags.add('W_KEY_CONFLICT');
  const accessKey = qrKey ?? textKey;
  return { accessKey, decoded: accessKey ? decodeAccessKey(accessKey) : null };
}

function resolvePurchaseDate(
  lines: string[],
  today: Date,
  decoded: ParsedAccessKey | null,
  flags: Set<WarningKey>,
) {
  const dateText = findDateText(lines);
  const purchaseDate = dateText ? parseBrDate(dateText, today) : null;
  if (!purchaseDate) flags.add('W_DATE_INVALID');
  if (purchaseDate && decoded && dateDiffersFromKey(purchaseDate, decoded)) flags.add('W_DATE_KEY_MISMATCH');
  return purchaseDate;
}

function resolveTotals(lines: string[], extracted: ExtractedItems, flags: Set<WarningKey>) {
  const itemsSumCents = sumOrNull(extracted.itemCents);
  const chosen = chooseTotal(lines, extracted.itemLineIdx, itemsSumCents);
  if (chosen.flag) flags.add(chosen.flag);
  const totalMismatch = findTotalMismatch(chosen.totalCents, itemsSumCents);
  if (totalMismatch) flags.add('W_TOTAL_MISMATCH');
  if (extracted.items.length === 0) flags.add('W_NO_ITEMS');
  if (chosen.totalCents === null) flags.add('W_NO_TOTAL');
  return { itemsSumCents, totalCents: chosen.totalCents, totalMismatch };
}

function parseUnsafe(text: string, options: ParseReceiptOptions): ParsedReceiptText {
  const flags = new Set<WarningKey>();
  const source = normalizeSource(text);
  const lines = splitLines(source);
  const { accessKey, decoded } = resolveAccessKey(lines, options, flags);
  const cnpj = resolveCnpj(source, decoded);
  if (cnpj.invalid) flags.add('W_CNPJ_INVALID');
  const purchaseDate = resolvePurchaseDate(lines, options.today, decoded, flags);
  const extracted = extractItems(lines);
  const totals = resolveTotals(lines, extracted, flags);

  return {
    merchantName: findMerchantName(lines),
    cnpj: cnpj.cnpj,
    cnpjSource: cnpj.source,
    accessKey,
    accessKeyValid: accessKey !== null,
    documentNumber: resolveDocumentNumber(source, decoded),
    purchaseDate,
    totalAmount: centsToMoney(totals.totalCents),
    items: extracted.items,
    itemsSum: centsToMoney(totals.itemsSumCents),
    totalMismatch: totals.totalMismatch,
    warnings: orderWarnings(flags, extracted.itemWarnings),
    rawTextRedacted: redactedExcerpt(source),
  };
}

/** Nunca lanca por texto estranho: qualquer falha vira resultado vazio com avisos. */
export function parseReceiptText(text: string, options: ParseReceiptOptions): ParsedReceiptText {
  try {
    return parseUnsafe(text, options);
  } catch {
    return emptyResult();
  }
}
