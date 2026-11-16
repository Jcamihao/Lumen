import { normalizeWord } from './normalize';
import { parseAmountPrefix } from './amount.parser';

export type ReadIntent =
  | 'balance'
  | 'month_summary'
  | 'spend_total'
  | 'upcoming_dues'
  | 'installments'
  | 'fixed_bills'
  | 'goals'
  | 'envelopes'
  | 'credit_card'
  | 'help';

/**
 * Depois da frase da consulta, até quantas palavras ainda contam como comando curto
 * ("o que vence esta semana", "metas de viagem"). Acima disso é pergunta livre e vai ao Selah.
 */
const FINANCE_READ_MAX_EXTRA_WORDS = 3;

/** Consultas de finanças por conversa (contrato 3a, secao 2; "reservas" = envelopes, contrato 3b1 parte A). */
const FINANCE_READ_PHRASES: Array<{ intent: ReadIntent; phrases: string[] }> = [
  { intent: 'upcoming_dues', phrases: ['o que vence', 'vencimentos', 'proximos vencimentos', 'contas a vencer'] },
  { intent: 'installments', phrases: ['minhas parcelas', 'parcelas', 'parcelados', 'compras parceladas'] },
  { intent: 'fixed_bills', phrases: ['contas fixas', 'despesas fixas', 'gastos recorrentes', 'recorrencias'] },
  { intent: 'goals', phrases: ['minhas metas', 'metas'] },
  {
    intent: 'envelopes',
    phrases: ['minhas reservas', 'reservas', 'como esta minha reserva', 'envelopes'],
  },
];

export type IntentMatch =
  | { intent: ReadIntent }
  | { intent: 'spend_by_category'; categoryQuery: string }
  | { intent: 'create_expense' | 'create_income'; body: string; missingAmount?: true }
  | { intent: 'create_goal'; body: string; cofrinho?: true }
  | { intent: 'contribute_goal'; body: string }
  | { intent: 'create_envelope' | 'set_credit_limit'; body: string };

const EXPENSE_VERBS = ['gastei', 'paguei', 'comprei'];

/** Verbo sem valor só vira comando curto ("gastei mercado"); frase longa ou pergunta é conversa livre. */
const MISSING_AMOUNT_MAX_WORDS = 3;

/** Comando de escrita de meta (contrato 3b1, secao 3): até 6 palavras no total e sem "?". */
const GOAL_COMMAND_MAX_WORDS = 6;
const GOAL_CREATE_PHRASES = ['criar meta', 'nova meta', 'criar cofrinho'];
const GOAL_CONTRIBUTE_PHRASES = ['guardar', 'aportar', 'poupar', 'depositar', 'colocar', 'aporte de'];

/**
 * Casa a mensagem com uma intencao da tabela do contrato. Devolve null se nada casou.
 * Ordem importa: create antes de leitura; "gastos com X" antes de "gastos".
 */
export function matchIntent(raw: string): IntentMatch | null {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0);
  const words = tokens.map(normalizeWord);
  if (words.length === 0) {
    return null;
  }

  const envelopeOrLimit = matchEnvelopeOrLimit(raw, tokens, words);
  if (envelopeOrLimit) return envelopeOrLimit;

  const income = matchIncome(tokens, words);
  if (income) return income;

  const expense = matchExpense(tokens, words);
  if (expense) return expense;

  const goalWrite = matchGoalWrite(raw, tokens, words);
  if (goalWrite) return goalWrite;

  const byCategory = matchSpendByCategory(tokens, words);
  if (byCategory) return byCategory;

  const phrase = words.join(' ');
  if (phrase === 'ajuda' || startsWithPhrase(phrase, 'o que voce faz')) return { intent: 'help' };
  if (startsWithPhrase(phrase, 'saldo') || startsWithPhrase(phrase, 'quanto tenho')) {
    return { intent: 'balance' };
  }
  if (startsWithPhrase(phrase, 'resumo')) return { intent: 'month_summary' };
  if (phrase === 'quanto gastei' || phrase === 'gastos' || startsWithPhrase(phrase, 'gastos do mes')) {
    return { intent: 'spend_total' };
  }
  const finance = matchFinanceRead(raw, phrase);
  if (finance) return finance;
  if (
    phrase === 'limite' ||
    startsWithPhrase(phrase, 'limite do cartao') ||
    startsWithPhrase(phrase, 'cartao') ||
    startsWithPhrase(phrase, 'quanto sobrou no cartao')
  ) {
    return { intent: 'credit_card' };
  }
  return null;
}

/** As intenções novas têm seu próprio limite; não ampliam o matcher do 3b1. */
function matchEnvelopeOrLimit(raw: string, tokens: string[], words: string[]): IntentMatch | null {
  if (raw.length > 500 || tokens.length > 20 || raw.includes('?')) return null;
  const phrase = words.join(' ');
  for (const expected of ['criar reserva', 'nova reserva', 'criar envelope']) {
    if (startsWithPhrase(phrase, expected)) {
      return { intent: 'create_envelope', body: tokens.slice(expected.split(' ').length).join(' ') };
    }
  }
  for (const expected of ['definir limite do cartao', 'definir limite']) {
    if (startsWithPhrase(phrase, expected)) {
      return { intent: 'set_credit_limit', body: tokens.slice(expected.split(' ').length).join(' ') };
    }
  }
  return null;
}

/**
 * A frase sozinha (com ou sem "?") sempre casa. Com palavras depois, só casa se for curto e sem "?":
 * "minhas metas estão boas?" e "parcelas do carro vale a pena" são conversa e vão ao Selah.
 */
function matchFinanceRead(raw: string, phrase: string): IntentMatch | null {
  for (const { intent, phrases } of FINANCE_READ_PHRASES) {
    for (const expected of phrases) {
      if (!startsWithPhrase(phrase, expected)) continue;
      const extraWords = phrase.slice(expected.length).split(' ').filter((word) => word.length > 0).length;
      if (extraWords === 0 || (extraWords <= FINANCE_READ_MAX_EXTRA_WORDS && !raw.includes('?'))) {
        return { intent };
      }
    }
  }
  return null;
}

function matchIncome(tokens: string[], words: string[]): IntentMatch | null {
  let skip = 0;
  if (words[0] === 'recebi' || words[0] === 'ganhei') {
    skip = 1;
  } else if (words[0] === 'entrada' && words[1] === 'de') {
    skip = 2;
  } else {
    return null;
  }
  const body = tokens.slice(skip).join(' ');
  return isAmountStart(body) ? { intent: 'create_income', body } : missingAmount('create_income', body);
}

function matchExpense(tokens: string[], words: string[]): IntentMatch | null {
  const skip = EXPENSE_VERBS.includes(words[0]) ? 1 : 0;
  const body = tokens.slice(skip).join(' ');
  if (isAmountStart(body)) return { intent: 'create_expense', body };
  return skip === 1 ? missingAmount('create_expense', body) : null;
}

function missingAmount(intent: 'create_expense' | 'create_income', body: string): IntentMatch | null {
  const wordCount = body.split(/\s+/).filter((word) => word.length > 0).length;
  if (body.includes('?') || wordCount > MISSING_AMOUNT_MAX_WORDS) {
    return null;
  }
  return { intent, body, missingAmount: true };
}

/**
 * Criar meta e aporte. Comando curto só: o corpo (nome, valor) é interpretado pelo motor
 * (parsers/goal.parser.ts), não aqui. Pergunta longa ou com "?" não casa e vai ao Selah.
 */
function matchGoalWrite(raw: string, tokens: string[], words: string[]): IntentMatch | null {
  if (tokens.length > GOAL_COMMAND_MAX_WORDS || raw.includes('?')) {
    return null;
  }
  const phrase = words.join(' ');
  for (const expected of GOAL_CREATE_PHRASES) {
    if (startsWithPhrase(phrase, expected)) {
      const body = tokens.slice(expected.split(' ').length).join(' ');
      // "criar cofrinho" é meta sem alvo: o motor não pergunta o alvo (contrato 3b1, secao 3).
      return expected === 'criar cofrinho' ? { intent: 'create_goal', body, cofrinho: true } : { intent: 'create_goal', body };
    }
  }
  for (const expected of GOAL_CONTRIBUTE_PHRASES) {
    if (startsWithPhrase(phrase, expected)) {
      return { intent: 'contribute_goal', body: tokens.slice(expected.split(' ').length).join(' ') };
    }
  }
  return null;
}

function matchSpendByCategory(tokens: string[], words: string[]): IntentMatch | null {
  const phrase = words.join(' ');
  let skip = 0;
  if (startsWithPhrase(phrase, 'gastos com')) {
    skip = 2;
  } else if (startsWithPhrase(phrase, 'quanto gastei com')) {
    skip = 3;
  } else {
    return null;
  }
  const categoryQuery = tokens.slice(skip).join(' ').trim();
  return categoryQuery.length > 0 ? { intent: 'spend_by_category', categoryQuery } : null;
}

/** Comeca com valor (mesmo invalido, como 0 ou -5): e tentativa de lançamento e recebe a correcao. */
function isAmountStart(body: string): boolean {
  if (body.length === 0) {
    return false;
  }
  const result = parseAmountPrefix(body);
  if (result.ok === true) {
    return true;
  }
  return result.reason !== 'NOT_AMOUNT';
}

function startsWithPhrase(phrase: string, expected: string): boolean {
  return phrase === expected || phrase.startsWith(`${expected} `);
}
