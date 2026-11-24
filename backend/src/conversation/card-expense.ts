import { ChatCard, matchCardsByTerm } from './credit-limit';
import { normalize, normalizeWord } from './parsers/normalize';

/*
 * Cartao no lancamento de despesa pela conversa (contrato 9b, secao 2.1 a 2.4). Funcoes puras: sem banco, sem Nest.
 * "no/na/do/da <cartao>" casa so com cartao ativo do dono; "no credito/cartao" sem nome decide pela quantidade.
 */

export const CARD_EXPENSE_REPLIES = {
  choose: (names: string[]): string =>
    `Em qual cartão? ${names.map((name, index) => `${index + 1}) ${name}`).join(' ')} ou responda pelo nome.`,
};

/** Conectores que antecedem o cartao ("no nubank", "do itau"). */
const CARD_CONNECTORS = new Set(['no', 'na', 'do', 'da', 'nos', 'nas']);
/** Palavras que dizem "cartao/credito" logo depois do conector ("no credito nubank"). */
const CREDIT_WORDS = new Set(['credito', 'cartao']);

/**
 * Resultado da busca no texto da despesa. from e to sao indices (to incluido) dos tokens a tirar da descricao.
 * - card: cartao casou (de forma unica).
 * - credit: "no credito" sem nome; quem chama decide pela quantidade de cartoes.
 * - notFound / ambiguous: termo com cara de cartao explicito ("no cartao X") que nao casa; nada e gravado.
 */
export type CardPhrase =
  | { kind: 'card'; card: ChatCard; from: number; to: number }
  | { kind: 'credit'; from: number; to: number }
  | { kind: 'notFound'; term: string; from: number; to: number }
  | { kind: 'ambiguous'; term: string; hits: ChatCard[]; from: number; to: number };

/**
 * Procura o trecho de cartao nos tokens da despesa (ja sem valor e sem data).
 * Sem cartao explicito ("cartao/credito" na frente) so casa nome igual (sem acento/caixa): "no mercado"
 * continua descricao se nao for nome de cartao. Com a palavra explicita, usa matchCardsByTerm (8d).
 */
export function findCardPhrase(tokens: string[], cards: ChatCard[]): CardPhrase | null {
  const words = tokens.map((token) => normalizeWord(token));
  for (let start = 0; start < tokens.length; start += 1) {
    if (!CARD_CONNECTORS.has(words[start])) continue;
    let first = start + 1;
    const explicit = first < tokens.length && CREDIT_WORDS.has(words[first]);
    if (explicit) first += 1;

    if (first >= tokens.length) {
      if (explicit) return { kind: 'credit', from: start, to: first - 1 };
      continue;
    }

    if (explicit) {
      for (let end = first; end < tokens.length; end += 1) {
        const term = tokens.slice(first, end + 1).join(' ');
        const hits = matchCardsByTerm(cards, term);
        if (hits.length === 1) return { kind: 'card', card: hits[0], from: start, to: end };
        if (hits.length > 1) return { kind: 'ambiguous', term, hits, from: start, to: end };
      }
      return { kind: 'notFound', term: tokens[first], from: start, to: first };
    }

    for (let end = first; end < tokens.length; end += 1) {
      const term = normalize(tokens.slice(first, end + 1).join(' '));
      const hits = cards.filter((card) => normalize(card.name) === term);
      if (hits.length === 1) return { kind: 'card', card: hits[0], from: start, to: end };
    }
  }
  return null;
}

/** Tira do texto o intervalo from..to (incluido). */
export function removeTokenRange(tokens: string[], from: number, to: number): string[] {
  return [...tokens.slice(0, from), ...tokens.slice(to + 1)];
}
