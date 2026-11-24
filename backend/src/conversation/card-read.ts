/*
 * Leitura por cartao e lista de cartoes pela conversa (contrato 9b, secoes 2.3 e 2.4). Funcoes puras: sem banco, sem Nest.
 * O cartao e buscado sempre pelo userId do vinculo (no servico); aqui so o texto.
 */

export const CARD_READ_REPLIES = {
  none: 'Você ainda não tem cartão ativo.',
  notFound: (term: string, names: string[]): string => `Não achei cartão com "${term}". Cartões: ${names.join(', ')}.`,
  ambiguous: (term: string, names: string[]): string =>
    `Mais de um cartão bate com "${term}": ${names.join(', ')}. Refaça com o nome completo.`,
};

/** Cartao ativo na lista: padrao primeiro (ja vem ordenado do servico). */
export interface CardListRow {
  name: string;
  isDefault: boolean;
  closingDay: number;
  dueDay: number | null;
}

/** "Meus cartoes": nome, qual e o padrao, fechamento e vencimento quando houver. */
export function cardListText(cards: CardListRow[]): string {
  if (cards.length === 0) return CARD_READ_REPLIES.none;
  const lines = cards.map((card) => {
    const tag = card.isDefault ? ' (padrão)' : '';
    const due = card.dueDay ? `, vencimento dia ${card.dueDay}` : '';
    return `- ${card.name}${tag}: fechamento dia ${card.closingDay}${due}`;
  });
  return ['Seus cartões:', ...lines].join('\n');
}

/** Leitura de um cartao nomeado: a primeira linha diz qual cartao e. */
export function namedCardText(name: string, body: string): string {
  return `Cartão: ${name}\n${body}`;
}
