import { normalizeWord } from './normalize';
import { parseAmountPrefix } from './amount.parser';

export type ReadIntent = 'balance' | 'month_summary' | 'spend_total' | 'credit_card' | 'help';

export type IntentMatch =
  | { intent: ReadIntent }
  | { intent: 'spend_by_category'; categoryQuery: string }
  | { intent: 'create_expense' | 'create_income'; body: string; missingAmount?: true };

const EXPENSE_VERBS = ['gastei', 'paguei', 'comprei'];

/** Verbo sem valor só vira comando curto ("gastei mercado"); frase longa ou pergunta é conversa livre. */
const MISSING_AMOUNT_MAX_WORDS = 3;

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

  const income = matchIncome(tokens, words);
  if (income) return income;

  const expense = matchExpense(tokens, words);
  if (expense) return expense;

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
