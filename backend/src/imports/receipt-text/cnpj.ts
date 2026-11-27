import { fixNumericOcr, OCR_DIGIT } from './ocr-digits';
import { ParsedAccessKey } from './receipt-text.types';

const CNPJ_CANDIDATE_RE = new RegExp(
  `${OCR_DIGIT}{2}\\.${OCR_DIGIT}{3}\\.${OCR_DIGIT}{3}/${OCR_DIGIT}{4}-${OCR_DIGIT}{2}`,
  'g',
);
const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export type ResolvedCnpj = { cnpj: string | null; source: 'KEY' | 'TEXT' | null; invalid: boolean };

function cnpjDv(body: string, weights: number[]): number {
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(cnpj: string): boolean {
  if (typeof cnpj !== 'string' || !/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const dv1 = cnpjDv(cnpj.slice(0, 12), FIRST_WEIGHTS);
  const dv2 = cnpjDv(cnpj.slice(0, 12) + dv1, SECOND_WEIGHTS);
  return dv1 === Number(cnpj[12]) && dv2 === Number(cnpj[13]);
}

function findValidCnpjInText(source: string): { found: string | null; hadCandidates: boolean } {
  const candidates = [...source.matchAll(CNPJ_CANDIDATE_RE)].map((match) => match[0]);
  const found = candidates.map((c) => fixNumericOcr(c).replace(/\D/g, '')).find((c) => isValidCnpj(c));
  return { found: found ?? null, hadCandidates: candidates.length > 0 };
}

/** CNPJ da chave; senao do texto (com recuperacao de OCR no trecho). */
export function resolveCnpj(source: string, key: ParsedAccessKey | null): ResolvedCnpj {
  if (key) return { cnpj: key.cnpj, source: 'KEY', invalid: false };
  const { found, hadCandidates } = findValidCnpjInText(source);
  if (found) return { cnpj: found, source: 'TEXT', invalid: false };
  return { cnpj: null, source: null, invalid: hadCandidates };
}
