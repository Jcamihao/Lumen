import { fixNumericOcr, OCR_DIGIT } from './ocr-digits';
import { ParsedAccessKey } from './receipt-text.types';

const KEY_CANDIDATE_RE = new RegExp(
  `(?<!${OCR_DIGIT})${OCR_DIGIT}(?:[ \\t\\n]?${OCR_DIGIT}){43}(?!${OCR_DIGIT})`,
  'g',
);
const KEY_LABEL_RE = /CHAVE\s+DE\s+ACESSO/i;

function mod11Dv(body: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidAccessKeyDv(key: string): boolean {
  if (typeof key !== 'string' || !/^\d{44}$/.test(key)) return false;
  // 44 digitos iguais "fecham" o DV por acaso: recusa.
  if (/^(\d)\1{43}$/.test(key)) return false;
  return mod11Dv(key.slice(0, 43)) === Number(key[43]);
}

export function normalizeAccessKey(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  const key = fixNumericOcr(raw.replace(/\s+/g, ''));
  return isValidAccessKeyDv(key) ? key : null;
}

export function decodeAccessKey(key: string): ParsedAccessKey | null {
  if (!isValidAccessKeyDv(key)) return null;
  const month = Number(key.slice(4, 6));
  if (month < 1 || month > 12) return null;
  return {
    key,
    ufCode: key.slice(0, 2),
    year: 2000 + Number(key.slice(2, 4)),
    month,
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: key.slice(22, 25),
    number: key.slice(25, 34),
  };
}

/** Chave usavel: DV valido e mes valido. */
export function usableKey(key: string | null): string | null {
  return key && decodeAccessKey(key) ? key : null;
}

function firstValidKeyIn(text: string): string | null {
  for (const match of text.matchAll(KEY_CANDIDATE_RE)) {
    const key = usableKey(normalizeAccessKey(match[0]));
    if (key) return key;
  }
  return null;
}

function keyChunkAfterLabel(lines: string[], labelIdx: number): string {
  return lines
    .slice(labelIdx, labelIdx + 4)
    .map((line, i) => (i === 0 ? line.replace(/^.*CHAVE\s+DE\s+ACESSO/i, '') : line).replace(/CONSUMIDOR.*$/i, ''))
    .join('\n');
}

/** Procura a chave impressa: perto do rotulo primeiro, depois no texto todo. */
export function findTextKey(lines: string[]): string | null {
  // A ultima ocorrencia do rotulo vale (a nota pode repetir o cabecalho).
  let labelIdx = -1;
  lines.forEach((line, i) => {
    if (KEY_LABEL_RE.test(line)) labelIdx = i;
  });
  if (labelIdx >= 0) {
    const key = firstValidKeyIn(keyChunkAfterLabel(lines, labelIdx));
    if (key) return key;
  }
  return firstValidKeyIn(lines.join('\n'));
}
