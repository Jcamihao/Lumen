import { CreditCard } from '../models/domain.models';

/** Cartoes ativos, padrao primeiro e depois por nome. */
export function activeCards(cards: CreditCard[]): CreditCard[] {
  return cards
    .filter((card) => !card.archivedAt)
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, 'pt-BR'),
    );
}

/** So despesa no credito escolhe cartao. Receita, PIX e debito nao usam cartao. */
export function isCreditExpense(type: string, paymentMethod: string | null | undefined): boolean {
  return type === 'EXPENSE' && paymentMethod === 'CREDIT';
}

/**
 * Valor do seletor de cartao. Vazio quando o seletor nao vale (nao selecionavel, offline
 * ou so um cartao ativo): o servidor usa o padrao. Com dois ou mais, mantem a escolha ou volta ao padrao.
 */
export function pickCardId(current: string, cards: CreditCard[], selectable: boolean): string {
  const active = activeCards(cards);

  if (!selectable || active.length < 2) {
    return '';
  }

  return active.some((card) => card.id === current) ? current : active[0].id;
}

/** cardId do corpo da escrita: so existe quando o lancamento e despesa no credito. */
export function cardIdForPayload(cardId: string, creditExpense: boolean): string | undefined {
  return creditExpense && cardId ? cardId : undefined;
}
