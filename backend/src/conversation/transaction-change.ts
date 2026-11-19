import { parseAmountPrefix } from './parsers/amount.parser';
import { normalize } from './parsers/normalize';
import { TransactionChangeDraft } from './conversation.types';

/** Editar e apagar lançamento por conversa (contrato 8a). Funções puras: sem banco, sem Nest. */

/** Janela de busca e tamanho da lista (contrato 8a, secao 3). */
export const TX_CHANGE_WINDOW_DAYS = 180;
export const TX_CHANGE_MAX_CANDIDATES = 5;
export const TX_DAY_MS = 86_400_000;

export const TX_REPLIES = {
  askWhich: 'Qual lançamento? Diga parte da descrição, a categoria ou o valor. Ex.: apagar mercado',
  pickHeader: 'Qual lançamento? Responda com o número:',
  askChange: 'O que mudar? valor, descrição, categoria ou data. Ex.: valor 45',
  deleteWarning: 'Isto apaga de vez e não dá para desfazer.',
  deleteNeedsWord: 'Para apagar, responda apagar.',
  notFound: 'Não achei lançamento com isso nos últimos 180 dias.',
  onlyNonEditable: 'Esse lançamento veio de conta fixa, parcelado, meta ou nota; altere pela tela.',
  gone: 'Não encontrei mais esse lançamento.',
  notReady: 'Ainda não disponível.',
} as const;

export interface TxCandidate {
  id: string;
  description: string;
  amountCents: number;
  /** 'AAAA-MM-DD' (data-só, UTC). */
  date: string;
  createdAt: Date;
  updatedAt: Date;
  categoryId: string | null;
  categoryName: string | null;
  /** Lançamento manual: sem conta fixa, parcelado, meta nem nota (secao 3). */
  eligible: boolean;
}

export interface TxParsedSearch {
  term: string;
  amountCents: number | null;
}

/** Termo livre e/ou valor. Valor no começo ("32,90 farmacia") vira valor; o resto vira termo. */
export function parseSearch(body: string): TxParsedSearch {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { term: '', amountCents: null };
  const parsed = parseAmountPrefix(trimmed);
  if (parsed.ok === true) return { term: normalize(parsed.rest), amountCents: parsed.cents };
  return { term: normalize(trimmed), amountCents: null };
}

/** Casa pelo texto (descrição ou categoria, sem acento e caixa) ou pelo valor exato. */
export function matchesSearch(candidate: TxCandidate, search: TxParsedSearch): boolean {
  if (search.term.length > 0) {
    if (normalize(candidate.description).includes(search.term)) return true;
    if (normalize(candidate.categoryName ?? '').includes(search.term)) return true;
  }
  return search.amountCents !== null && candidate.amountCents === search.amountCents;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  return `${sign}${reais},${centavos}`;
}

/** 'AAAA-MM-DD' vira 'dd/mm'. */
export function formatDayMonth(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${day}/${month}`;
}

export function describeCandidate(candidate: TxCandidate): string {
  return `${formatCents(candidate.amountCents)} · ${candidate.description}`;
}

/** Linha da lista numerada: "1) 50,00 · Mercado · 18/11". */
export function formatCandidateLine(index: number, candidate: TxCandidate): string {
  const category = candidate.categoryName ? ` · ${candidate.categoryName}` : '';
  return `${index + 1}) ${formatCents(candidate.amountCents)} · ${candidate.description}${category} · ${formatDayMonth(candidate.date)}`;
}

/** Rascunho de apagar: a confirmação só vale com a palavra "apagar" (contrato 8a, secao 4). */
export function isDeleteChange(draft: unknown): boolean {
  const value = draft as { kind?: string; action?: string } | null;
  return value?.kind === 'TRANSACTION_CHANGE' && value.action === 'DELETE';
}

export function isTransactionChangeDraft(draft: unknown): draft is TransactionChangeDraft {
  return (draft as { kind?: string } | null)?.kind === 'TRANSACTION_CHANGE';
}
