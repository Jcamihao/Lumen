import { AmountFailure, parseAmountPrefix } from './parsers/amount.parser';
import { normalize, normalizeWord } from './parsers/normalize';

/**
 * Escolher o cartão e limpar o teto por conversa (contrato 8d). Funcoes puras: sem banco, sem Nest.
 * O rascunho continua o CREDIT_LIMIT dos 3b2b; aqui entram o termo do cartao e a acao de limpar.
 */

export const CL_REPLIES = {
  cardNotFound: (term: string, names: string[]): string =>
    `Não achei cartão com "${term}". Cartões: ${names.join(', ')}. Refaça, ex.: definir limite ${names[0]} 2000`,
  cardAmbiguous: (term: string, names: string[]): string =>
    `Mais de um cartão bate com "${term}": ${names.join(', ')}. Refaça com o nome completo.`,
  alreadyClear: 'Esse cartão já está sem teto neste ciclo.',
  clearNeedsWord: 'Para limpar o teto, responda limpar.',
};

/** Um cartão do dono, na forma que o chat precisa para escolher. */
export interface ChatCard {
  id: string;
  name: string;
}

export type LimitBody =
  | { status: 'empty' }
  | { status: 'amount'; cents: number }
  // Cartao (com ou sem valor). Valor nulo = ainda a informar (campo pendente do rascunho).
  | { status: 'card'; term: string; cents: number | null }
  // Algo pareceu valor mas e invalido (zero, negativo, ambiguo, gigante): a resposta e a do parser.
  | { status: 'error'; reason: AmountFailure };

/** Conectores e artigos que antecedem o nome do cartão ("do nubank", "no itaú", "cartao nubank"). */
const TERM_CONNECTORS = new Set(['do', 'da', 'de', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'o', 'a', 'os', 'as', 'meu', 'minha', 'cartao', 'cartoes', 'credito']);

/** Soma o valor onde quer que ele esteja: "2000", "nubank 2000", "do nubank 2 mil", "nubank". */
export function parseLimitBody(body: string): LimitBody {
  const text = body.trim();
  if (text === '') return { status: 'empty' };

  const head = parseAmountPrefix(text);
  if (head.ok === true) {
    const rest = cleanCardTerm(head.rest);
    if (rest === '') return { status: 'amount', cents: head.cents };
    return { status: 'card', term: rest, cents: head.cents };
  }
  if (head.reason !== 'NOT_AMOUNT') return { status: 'error', reason: head.reason };

  const tokens = text.split(/\s+/);
  const firstNumber = tokens.findIndex((token) => /^\d/.test(token));
  if (firstNumber === -1) {
    const term = cleanCardTerm(text);
    return term === '' ? { status: 'empty' } : { status: 'card', term, cents: null };
  }
  const tail = parseAmountPrefix(tokens.slice(firstNumber).join(' '));
  if (tail.ok === true && tail.rest === '') {
    const term = cleanCardTerm(tokens.slice(0, firstNumber).join(' '));
    return term === '' ? { status: 'amount', cents: tail.cents } : { status: 'card', term, cents: tail.cents };
  }
  if (tail.ok === false && tail.reason !== 'NOT_AMOUNT') return { status: 'error', reason: tail.reason };
  return { status: 'card', term: cleanCardTerm(text), cents: null };
}

/** Tira conectores da frente do termo ("do nubank" vira "nubank"). Comparaçao sempre via normalize. */
export function cleanCardTerm(text: string): string {
  const words = text.trim() === '' ? [] : text.trim().split(/\s+/);
  while (words.length > 0 && TERM_CONNECTORS.has(normalizeWord(words[0]))) words.shift();
  return words.join(' ').trim();
}

/**
 * Busca o cartão pelo nome em memoria (termo sem acento/caixa, como a busca do 8b): igualdade
 * vence; sem igual, pega quem contem o termo (ou o termo contem o nome). Vazio = sem escolha.
 */
export function matchCardsByTerm(cards: ChatCard[], term: string): ChatCard[] {
  const needle = normalize(term);
  if (needle === '') return cards;
  const exact = cards.filter((card) => normalize(card.name) === needle);
  if (exact.length > 0) return exact;
  return cards.filter((card) => {
    const name = normalize(card.name);
    return name.includes(needle) || needle.includes(name);
  });
}

/** O rascunho de LIMPEZA de teto (D3 do dono): precisa da palavra/flag, como o apagar do 8a. */
export function isClearLimitDraft(draft: unknown): boolean {
  const value = draft as { kind?: string; action?: string } | null;
  return value?.kind === 'CREDIT_LIMIT' && value?.action === 'clear';
}
