import { ParsedAccessKey } from './receipt-text.types';

// Numero do documento: so depois de "NFC-e n./nº/numero" ou de "Nº". Aceita milhar com ponto
// (000.123.456) e recusa numero seguido de "-dd" (pedaco de CPF). "NFC-e Serie 001" nao casa.
const DOC_DIGITS = '(\\d{1,3}(?:\\.\\d{3})+|\\d{1,9})(?!\\d|\\.\\d|-\\d)';
const DOC_NUMBER_RE = new RegExp(
  `\\bNFC-?e\\b[^\\n\\d]{0,6}?\\bN(?:[º°]|\\.|o\\b|[uú]mero|um\\b)\\s*[:.]?\\s*${DOC_DIGITS}|\\bN[º°]\\.?\\s*[:.]?\\s*${DOC_DIGITS}`,
  'i',
);

const stripLeadingZeros = (digits: string): string => digits.replace(/^0+(?=\d)/, '');

/** Da chave; senao do texto (sem pontos de milhar, sem zeros a esquerda, nunca "0"). */
export function resolveDocumentNumber(source: string, key: ParsedAccessKey | null): string | null {
  if (key) return stripLeadingZeros(key.number);
  const match = DOC_NUMBER_RE.exec(source);
  const digits = match ? (match[1] ?? match[2]).replace(/\./g, '') : null;
  if (!digits) return null;
  const number = stripLeadingZeros(digits);
  return number === '0' ? null : number;
}
