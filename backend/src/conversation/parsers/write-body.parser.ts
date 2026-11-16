import { firstDueLatestYmd } from '../../recurring-transactions/conversation-write.types';
import { AmountFailure, parseAmountPrefix } from './amount.parser';
import { parseDateToken } from './date.parser';
import { normalizeWord } from './normalize';

export type ChargeFrequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** Falhas do corpo: valor (como nas demais escritas), quantidade, total dado como parcela, ou descrição nula. */
export type BodyFailure = AmountFailure | 'QUANTITY' | 'TOTAL_ONLY';

export type BodyResult<T> = { ok: true; value: T } | { ok: false; reason: BodyFailure };

/**
 * Corpo de conta fixa: `[valor] <descrição> [mensal|semanal|anual] [primeiro <data>]`.
 * `description` é null quando não sobrou texto (≥ 2 caracteres); pode passar de 120 e o motor recusa.
 * `dueText` é null sem sufixo de data, '' para "primeiro" sem data, ou o texto da data.
 */
export interface RecurringBody {
  description: string | null;
  amountCents: number | null;
  frequency: ChargeFrequency | null;
  dueText: string | null;
}

/**
 * Corpo de parcelado: `[total] <descrição> [em <N>x] [primeiro <data>]`. O valor é sempre o total.
 */
export interface InstallmentBody {
  description: string | null;
  totalCents: number | null;
  installmentsTotal: number | null;
  dueText: string | null;
}

/** Resultado de ler a data do primeiro vencimento. */
export type DueResolution =
  | { kind: 'DATE'; ymd: string }
  | { kind: 'UNSUPPORTED' }
  | { kind: 'INVALID' }
  | { kind: 'PAST' }
  | { kind: 'TOO_FAR' };

const FREQUENCY_WORDS: Record<string, ChargeFrequency> = { mensal: 'MONTHLY', semanal: 'WEEKLY', anual: 'YEARLY' };
const CONNECTORS = new Set(['na', 'no', 'em', 'de', 'do', 'da', 'com', 'pra', 'para']);
const DESCRIPTION_MIN = 2;
/** Quantidade de parcelas aceita: inteiro de 2 a 60 (contrato 3b2, secao 4). */
export const INSTALLMENTS_MIN = 2;
export const INSTALLMENTS_MAX = 60;

export function parseRecurringBody(body: string): BodyResult<RecurringBody> {
  const amount = parseLeadingAmount(body);
  if (amount.ok === false) return amount;

  const due = takeDueSuffix(splitTokens(amount.rest));
  const frequency = takeFrequency(due.rest);

  return {
    ok: true,
    value: {
      description: describe(frequency.rest),
      amountCents: amount.cents,
      frequency: frequency.frequency,
      dueText: due.dueText,
    },
  };
}

export function parseInstallmentBody(body: string): BodyResult<InstallmentBody> {
  // "12x de 100" não é total de R$ 100: quem mandou a parcela precisa informar o total.
  const first = splitTokens(body)[0];
  if (first !== undefined && /^\d+x$/i.test(normalizeWord(first))) {
    return { ok: false, reason: 'TOTAL_ONLY' };
  }

  const amount = parseLeadingAmount(body);
  if (amount.ok === false) return amount;

  const due = takeDueSuffix(splitTokens(amount.rest));
  const quantity = takeQuantity(due.rest);
  if (quantity.ok === false) return quantity;

  return {
    ok: true,
    value: {
      description: describe(quantity.rest),
      totalCents: amount.cents,
      installmentsTotal: quantity.quantity,
      dueText: due.dueText,
    },
  };
}

/** Lê a data do primeiro vencimento. Só hoje, dd/mm e dd/mm/aaaa; o resto pede data completa. */
export function resolveFirstDue(text: string, todayYmd: string): DueResolution {
  const tokens = splitTokens(text);
  if (tokens.length !== 1) return { kind: 'UNSUPPORTED' };

  const parsed = parseDateToken(tokens[0], todayYmd);
  if (parsed === null) return { kind: 'UNSUPPORTED' };
  if (parsed.kind === 'INVALID') return { kind: 'INVALID' };
  if (parsed.ymd < todayYmd) return { kind: 'PAST' };
  if (parsed.ymd > firstDueLatestYmd(todayYmd)) return { kind: 'TOO_FAR' };
  return { kind: 'DATE', ymd: parsed.ymd };
}

/** Valor do início, se houver. Sem valor, o corpo inteiro segue como texto. */
function parseLeadingAmount(body: string): { ok: true; cents: number | null; rest: string } | { ok: false; reason: BodyFailure } {
  const text = body.trim();
  if (text === '') return { ok: true, cents: null, rest: '' };
  const parsed = parseAmountPrefix(text);
  if (parsed.ok === true) return { ok: true, cents: parsed.cents, rest: parsed.rest };
  if (parsed.reason === 'NOT_AMOUNT') return { ok: true, cents: null, rest: text };
  return { ok: false, reason: parsed.reason };
}

/**
 * "primeiro <data>" só vale como sufixo quando é o fim da frase e a palavra seguinte parece data.
 * "primeiro curso de inglês" continua sendo descrição.
 */
function takeDueSuffix(tokens: string[]): { rest: string[]; dueText: string | null } {
  let index = -1;
  tokens.forEach((token, position) => {
    if (normalizeWord(token) === 'primeiro') index = position;
  });
  if (index === -1) return { rest: tokens, dueText: null };

  const tail = tokens.slice(index + 1);
  if (tail.length === 0) return { rest: tokens.slice(0, index), dueText: '' };
  if (tail.length <= 3 && looksLikeDate(tail[0])) {
    return { rest: tokens.slice(0, index), dueText: tail.join(' ') };
  }
  return { rest: tokens, dueText: null };
}

function looksLikeDate(token: string): boolean {
  const word = normalizeWord(token);
  return /^\d/.test(word) || ['hoje', 'ontem', 'anteontem', 'amanha', 'dia'].includes(word);
}

/** Frequência só na última palavra ("internet mensal"); no meio da descrição fica como texto. */
function takeFrequency(tokens: string[]): { rest: string[]; frequency: ChargeFrequency | null } {
  const last = tokens[tokens.length - 1];
  const frequency = last === undefined ? undefined : FREQUENCY_WORDS[normalizeWord(last)];
  if (frequency === undefined) return { rest: tokens, frequency: null };
  return { rest: tokens.slice(0, -1), frequency };
}

/** "em 12x" (ou "em 12") no fim. Quantidade fora de 2 a 60 ou fracionária é recusada, não vira descrição. */
function takeQuantity(tokens: string[]): { ok: true; rest: string[]; quantity: number | null } | { ok: false; reason: 'QUANTITY' } {
  const count = tokens.length;
  if (count < 2 || normalizeWord(tokens[count - 2]) !== 'em') {
    return { ok: true, rest: tokens, quantity: null };
  }
  const match = /^(\d+(?:[.,]\d+)?)x?$/i.exec(tokens[count - 1]);
  if (!match) {
    return { ok: true, rest: tokens, quantity: null };
  }
  const digits = match[1];
  const value = Number(digits);
  if (!/^\d+$/.test(digits) || !Number.isInteger(value) || value < INSTALLMENTS_MIN || value > INSTALLMENTS_MAX) {
    return { ok: false, reason: 'QUANTITY' };
  }
  return { ok: true, rest: tokens.slice(0, count - 2), quantity: value };
}

/** Descrição: sem conectores no início; menos de 2 caracteres vira null (pergunta depois). */
function describe(tokens: string[]): string | null {
  let start = 0;
  while (start < tokens.length && CONNECTORS.has(normalizeWord(tokens[start]))) {
    start += 1;
  }
  const text = tokens.slice(start).join(' ');
  return text.length >= DESCRIPTION_MIN ? text : null;
}

function splitTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}
