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

const CEILING_MAX = 9_999_999_999;

/** Validacao do teto antes de enviar: positivo, ate 2 casas e dentro do limite do servidor. Nulo = mensagem. */
export function ceilingError(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0.01) {
    return 'Informe um teto maior que zero.';
  }

  if (value > CEILING_MAX) {
    return 'Use um valor menor que dez bilhões.';
  }

  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
    return 'Use no máximo duas casas decimais.';
  }

  return null;
}

type ReadMessage = (error: unknown, fallback: string) => string;

/** Texto do erro de gravar teto. 5xx: resultado desconhecido, nao repetir. */
export function ceilingSaveMessage(error: unknown, readMessage: ReadMessage): string {
  const status = (error as { status?: number } | null)?.status ?? 0;

  if (status === 404) return 'Cartão não encontrado. Atualize a tela.';
  if (status === 409) return readMessage(error, 'Cartão arquivado não recebe teto.');
  if (status === 400) return readMessage(error, 'Informe um limite positivo com até duas casas decimais.');
  if (isUncertainSave(error)) return 'Não sei se o teto foi salvo. Confira a tela antes de tentar de novo.';

  return 'Não foi possível salvar o teto agora.';
}

/** Sem resposta (status 0: rede caiu no meio) ou 5xx: o servidor pode ter gravado. Nao repetir. */
export function isUncertainSave(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status ?? 0;

  return status === 0 || status >= 500;
}
