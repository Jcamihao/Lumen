import { moneyCents } from './money';
import { WarningKey } from './receipt-warnings';
import { ReceiptTotalMismatch } from './receipt-text.types';
import { MAX_LINE_CHARS } from './text-limits';

const TOTAL_LABEL_RE = /VALOR\s+TOTAL|TOTAL\s*R\$|VALOR\s+A\s+PAGAR|TOTAL\s+A\s+PAGAR|\bTOTAL\b/i;
// Linhas que parecem total mas nao sao: quantidade, itens, desconto, troco, tributos, subtotal (contrato)
// e, para nao tomar valor pago ou imposto como total, pago/recebido/imposto/acrescimo.
const TOTAL_SKIP_RE = /QTD|ITENS|DESCONTO|TROCO|TRIBUTOS|SUBTOTAL|\bPAGO\b|RECEBIDO|IMPOSTO|ACR[EÉ]SCIMO/i;
// O lookbehind faz a busca comecar so no inicio de cada corrida de digitos (sem ele, uma linha
// gigante de digitos custa tempo quadratico) e impede ler "1234.567,89" como "234.567,89".
const MONEY_IN_LINE_RE = /(?<![\d.,])(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)/g;

export type ChosenTotal = { totalCents: number | null; flag: WarningKey | null };

function lastMoneyInLine(line: string): number | null {
  let last: number | null = null;
  for (const match of line.matchAll(MONEY_IN_LINE_RE)) {
    const cents = moneyCents(match[0]);
    if (cents !== null) last = cents;
  }
  return last;
}

function isTotalLine(line: string, isItemLine: boolean): boolean {
  // Linha de item nunca e total (ex.: produto "TOTAL CLEAN"); linha gigante nao e linha de cupom.
  if (isItemLine || line.length > MAX_LINE_CHARS) return false;
  return TOTAL_LABEL_RE.test(line) && !TOTAL_SKIP_RE.test(line);
}

/** Candidatos rotulados como total, sem linhas de quantidade, desconto, troco etc. */
function totalCandidates(lines: string[], itemLineIdx: Set<number>): number[] {
  const candidates = new Set<number>();
  lines.forEach((line, i) => {
    if (!isTotalLine(line, itemLineIdx.has(i))) return;
    const last = lastMoneyInLine(line);
    if (last !== null) candidates.add(last);
  });
  return [...candidates];
}

function chooseAmongMany(options: number[], itemsSumCents: number | null): ChosenTotal {
  const equal = itemsSumCents === null ? undefined : options.find((c) => c === itemsSumCents);
  // O valor bruto bate com os itens, mas a nota imprime outro total (desconto geral):
  // o usuario pagou o outro. Nao escolhemos sozinhos; avisamos.
  if (equal !== undefined) return { totalCents: equal, flag: 'W_TOTAL_MULTIPLE' };
  return { totalCents: options.reduce((a, b) => Math.max(a, b), 0), flag: 'W_TOTAL_AMBIGUOUS' };
}

export function chooseTotal(lines: string[], itemLineIdx: Set<number>, itemsSumCents: number | null): ChosenTotal {
  const options = totalCandidates(lines, itemLineIdx);
  if (options.length === 0) return { totalCents: null, flag: null };
  if (options.length === 1) return { totalCents: options[0], flag: null };
  return chooseAmongMany(options, itemsSumCents);
}

/** Divergencia so acima de 1 centavo. */
export function findTotalMismatch(totalCents: number | null, itemsSumCents: number | null): ReceiptTotalMismatch | null {
  if (totalCents === null || itemsSumCents === null) return null;
  if (Math.abs(totalCents - itemsSumCents) <= 1) return null;
  return {
    itemsSum: itemsSumCents / 100,
    total: totalCents / 100,
    difference: (totalCents - itemsSumCents) / 100,
  };
}
