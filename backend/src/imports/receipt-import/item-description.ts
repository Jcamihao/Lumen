import { normalizeText } from './text-helpers';

const IGNORED_MATCH_TOKENS = ['de', 'da', 'do', 'e', 'com'];

export function normalizeReceiptItemDescription(value: string): string {
  return String(value || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\d.\-xX]+\s+/, '')
    .trim();
}

/** Chave estavel para comparar o mesmo produto entre notas (sem acento, sem artigos, em ordem). */
export function normalizeReceiptItemMatchKey(value: string): string {
  return normalizeReceiptItemDescription(value)
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => normalizeText(token))
    .filter(Boolean)
    .filter((token) => !IGNORED_MATCH_TOKENS.includes(token))
    .sort()
    .join(' ');
}

export function buildReceiptTransactionDescription(merchantName: string): string {
  const normalized = String(merchantName || '').trim();
  if (!normalized) return 'Compra registrada';
  if (normalizeText(normalized).startsWith('compra ')) return normalized;
  return `Compra em ${normalized}`;
}
