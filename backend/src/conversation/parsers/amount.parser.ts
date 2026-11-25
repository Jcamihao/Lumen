/** Limite inclusivo de 1.000.000,00 em centavos. */
export const MAX_AMOUNT_CENTS = 100_000_000;

export type AmountFailure = 'NOT_AMOUNT' | 'AMBIGUOUS' | 'ZERO' | 'NEGATIVE' | 'TOO_LARGE';

export type AmountResult =
  | { ok: true; cents: number; rest: string }
  | { ok: false; reason: AmountFailure };

/**
 * Le o valor no comeco do texto e devolve centavos inteiros (nunca float).
 * Aceita: 32,90 | 32.90 | 1.234,56 | 1.234 | 1234 | 2 mil | 2k | 2,5 mil | R$ 10.
 * Ambiguo (1,234 ou 1,234.56) devolve AMBIGUOUS: quem chama pede correcao, nunca chuta.
 */
export function parseAmountPrefix(input: string): AmountResult {
  let text = input.trim().replace(/^r\$\s*/i, '');
  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1).trimStart();
  }

  const token = text.split(/\s+/)[0] ?? '';
  let rest = text.slice(token.length).trim();
  if (!/^\d/.test(token)) {
    return { ok: false, reason: 'NOT_AMOUNT' };
  }

  let body = token;
  let multiplier = 1;
  if (/^\d+(?:[.,]\d{1,2})?k$/i.test(token)) {
    body = token.slice(0, -1);
    multiplier = 1000;
  } else if (/^mil\b/i.test(rest)) {
    multiplier = 1000;
    rest = rest.replace(/^mil\s*/i, '').trim();
  }

  const parsed = parseNumberBody(body);
  if (parsed === 'AMBIGUOUS') {
    return { ok: false, reason: 'AMBIGUOUS' };
  }
  if (parsed === null) {
    return { ok: false, reason: 'NOT_AMOUNT' };
  }

  const cents = parsed * multiplier;
  if (negative) {
    return { ok: false, reason: 'NEGATIVE' };
  }
  if (cents === 0) {
    return { ok: false, reason: 'ZERO' };
  }
  if (cents > MAX_AMOUNT_CENTS) {
    return { ok: false, reason: 'TOO_LARGE' };
  }
  return { ok: true, cents, rest: rest.replace(/^contos?\b\s*/i, '') };
}

/** Converte o numero sem "mil"/"k" para centavos, com aritmetica inteira. */
function parseNumberBody(body: string): number | 'AMBIGUOUS' | null {
  // 1.234,56 (milhar com ponto, decimal com virgula)
  let match = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(body);
  if (match) {
    return toCents(match[1].replace(/\./g, ''), match[2]);
  }
  // 1.234 (ponto de milhar, sem centavos)
  match = /^(\d{1,3}(?:\.\d{3})+)$/.exec(body);
  if (match) {
    return toCents(match[1].replace(/\./g, ''), '');
  }
  // 32,90
  match = /^(\d+),(\d{1,2})$/.exec(body);
  if (match) {
    return toCents(match[1], match[2]);
  }
  // 32.90
  match = /^(\d+)\.(\d{1,2})$/.exec(body);
  if (match) {
    return toCents(match[1], match[2]);
  }
  // 1234
  match = /^(\d+)$/.exec(body);
  if (match) {
    return toCents(match[1], '');
  }
  // 1,234 ou 1,234.56: separadores ambiguos
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(body) || /^\d+,\d{3}$/.test(body)) {
    return 'AMBIGUOUS';
  }
  return null;
}

function toCents(integerPart: string, fraction: string): number {
  const reais = Number(integerPart);
  const centavos = Number(fraction.padEnd(2, '0'));
  return reais * 100 + centavos;
}
