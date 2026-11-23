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
  | { intent: 'import_receipt' }
  | { intent: 'spend_by_category'; categoryQuery: string }
  | { intent: 'create_expense' | 'create_income'; body: string; missingAmount?: true }
  | { intent: 'create_goal'; body: string; cofrinho?: true }
  | { intent: 'contribute_goal'; body: string }
  | { intent: 'create_envelope' | 'set_credit_limit' | 'create_recurring' | 'create_installment'; body: string }
  | { intent: 'edit_transaction' | 'delete_transaction'; body: string }
  | { intent: 'edit_goal' | 'delete_goal' | 'edit_envelope' | 'delete_envelope'; body: string };

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

  const transactionChange = matchTransactionChange(raw, tokens, words);
  if (transactionChange) return transactionChange;

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
  if (matchImportReceipt(raw, phrase)) return { intent: 'import_receipt' };
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

/** Editar e apagar por conversa (contratos 8a e 8b): comando curto, até 6 palavras e sem "?". */
const TRANSACTION_CHANGE_MAX_WORDS = 6;
const TRANSACTION_DELETE_VERBS = ['apagar', 'excluir', 'remover'];
const TRANSACTION_EDIT_VERBS = ['editar', 'corrigir', 'alterar'];
/** Artigos e poses que podem anteceder o substantivo do alvo ("editar a minha meta viagem"). */
const CHANGE_ARTICLES = new Set(['o', 'a', 'uma', 'um', 'minha', 'meu', 'minhas', 'meus']);

function matchTransactionChange(raw: string, tokens: string[], words: string[]): IntentMatch | null {
  if (tokens.length > TRANSACTION_CHANGE_MAX_WORDS || raw.includes('?')) return null;
  let action: 'edit' | 'delete';
  if (TRANSACTION_DELETE_VERBS.includes(words[0])) {
    action = 'delete';
  } else if (TRANSACTION_EDIT_VERBS.includes(words[0])) {
    action = 'edit';
  } else {
    return null;
  }
  let rest = tokens.slice(1);
  // O substantivo escolhe o alvo (contrato 8b, secao 3); sem substantivo é lançamento (contrato 8a).
  while (rest.length > 0 && CHANGE_ARTICLES.has(normalizeWord(rest[0]))) rest = rest.slice(1);
  const noun = rest.length > 0 ? normalizeWord(rest[0]) : '';
  if (noun === 'meta' || noun === 'metas' || noun === 'cofrinho') {
    return { intent: action === 'delete' ? 'delete_goal' : 'edit_goal', body: rest.slice(1).join(' ').trim() };
  }
  if (noun === 'reserva' || noun === 'reservas' || noun === 'envelope') {
    return { intent: action === 'delete' ? 'delete_envelope' : 'edit_envelope', body: rest.slice(1).join(' ').trim() };
  }
  if (noun === 'lancamento') rest = rest.slice(1);
  let body = rest.join(' ').trim();
  // "apagar conta" sem termo: o motor pergunta qual lançamento (contrato 8a, secao 2).
  if (normalizeWord(body) === 'conta') body = '';
  return { intent: action === 'delete' ? 'delete_transaction' : 'edit_transaction', body };
}

/** Comandos de escrita novos (reserva, limite, conta fixa, parcelado): até 20 palavras e 500 caracteres. Não ampliam o matcher do 3b1. */
const NEW_WRITE_MAX_WORDS = 20;
const RAW_MAX_CHARS = 500;

/** As intenções novas (reserva, limite, conta fixa, parcelado) têm seu próprio limite de 20 palavras; não ampliam o matcher do 3b1. */
function matchEnvelopeOrLimit(raw: string, tokens: string[], words: string[]): IntentMatch | null {
  if (raw.length > RAW_MAX_CHARS || tokens.length > NEW_WRITE_MAX_WORDS || raw.includes('?')) return null;
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
  for (const expected of ['criar conta fixa', 'nova conta fixa']) {
    if (startsWithPhrase(phrase, expected)) {
      return { intent: 'create_recurring', body: tokens.slice(expected.split(' ').length).join(' ') };
    }
  }
  for (const expected of ['criar parcelado', 'novo parcelado']) {
    if (startsWithPhrase(phrase, expected)) {
      return { intent: 'create_installment', body: tokens.slice(expected.split(' ').length).join(' ') };
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

/** Contrato do item 4, secao 9: mesma regra das leituras (frase sozinha, ou curta e sem "?"). */
const IMPORT_RECEIPT_PHRASES = ['importar nota fiscal', 'importar nota', 'ler nota', 'enviar nota'];

function matchImportReceipt(raw: string, phrase: string): boolean {
  for (const expected of IMPORT_RECEIPT_PHRASES) {
    if (!startsWithPhrase(phrase, expected)) continue;
    const extraWords = phrase.slice(expected.length).split(' ').filter((word) => word.length > 0).length;
    if (extraWords === 0 || (extraWords <= FINANCE_READ_MAX_EXTRA_WORDS && !raw.includes('?'))) return true;
  }
  return false;
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
