import { TransactionType } from '@prisma/client';
import { AmountFailure, parseAmountPrefix } from './parsers/amount.parser';
import { parseDateToken } from './parsers/date.parser';
import { normalize, normalizeWord } from './parsers/normalize';
import { TransactionChangeDraft } from './conversation.types';

/** Editar e apagar lançamento por conversa (contrato 8a). Funções puras: sem banco, sem Nest. */

/** Janela de busca e tamanho da lista (contrato 8a, secao 3). */
export const TX_CHANGE_WINDOW_DAYS = 180;
export const TX_CHANGE_MAX_CANDIDATES = 5;
/** Lista dos ultimos lancamentos (menu): itens por pagina. */
export const TX_LIST_PAGE_SIZE = 15;
export const TX_DAY_MS = 86_400_000;
/** Limites de descrição iguais aos do criar lançamento. */
export const TX_DESCRIPTION_MIN = 2;
export const TX_DESCRIPTION_MAX = 120;

export const TX_REPLIES = {
  askWhich: 'Qual lançamento? Diga parte da descrição, a categoria ou o valor. Ex.: apagar mercado',
  pickHeader: 'Qual lançamento? Responda com o número:',
  moreHint: 'Para ver os próximos, diga mais.',
  noMore: 'Não há mais lançamentos.',
  emptyList: 'Você ainda não tem lançamentos que dê para mudar por aqui. Para registrar um, diga: gastei 50 no mercado.',
  askChange: 'O que mudar? valor, descrição, categoria ou data. Ex.: valor 45',
  deleteWarning: 'Isto apaga de vez e não dá para desfazer.',
  deleteNeedsWord: 'Para apagar, responda apagar.',
  notFound: 'Não achei lançamento com isso nos últimos 180 dias.',
  onlyNonEditable: 'Esse lançamento veio de conta fixa, parcelado, meta, nota ou é transferência; altere pela tela.',
  gone: 'Não encontrei mais esse lançamento.',
  notReady: 'Ainda não disponível.',
  changeNotUnderstood: 'Não entendi a mudança. Use: valor 45, descrição padaria, categoria mercado ou data 15/11.',
  descriptionShort: 'A descrição precisa ter pelo menos 2 letras.',
  descriptionLong: 'A descrição passou de 120 letras. Use um texto menor.',
  dateInvalid: 'Essa data não existe. Use dd/mm, ex.: 15/11.',
  nothingToChange: 'Nada para mudar. Escolha um campo ou responda cancelar.',
  editConfirm: 'Responda confirmar para salvar ou cancelar.',
  changed: 'Esse lançamento mudou desde que você escolheu; refaça a busca.',
  categoryNotFound: 'Não achei essa categoria. Use o nome de uma categoria sua.',
  categoryAmbiguous: 'Tem mais de uma categoria com esse nome. Escreva o nome completo.',
} as const;

export interface TxCandidate {
  id: string;
  type: TransactionType;
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

/** Mudança pedida em uma mensagem: "valor 45", "descrição padaria", "categoria mercado", "data 15/11". */
export type ChangeParse =
  | { ok: true; field: 'amountCents'; cents: number }
  | { ok: true; field: 'description'; text: string }
  | { ok: true; field: 'categoryName'; query: string }
  | { ok: true; field: 'date'; ymd: string }
  | { ok: false; text: string };

export function parseChange(value: string, today: string, amountError: (reason: AmountFailure) => string): ChangeParse {
  const trimmed = value.trim();
  const space = trimmed.search(/\s/);
  const key = normalizeWord(space === -1 ? trimmed : trimmed.slice(0, space));
  const rest = space === -1 ? '' : trimmed.slice(space).trim();
  if (key === 'valor') {
    const amount = parseAmountPrefix(rest);
    if (amount.ok === false) return { ok: false, text: amountError(amount.reason) };
    if (amount.rest.trim().length > 0) return { ok: false, text: TX_REPLIES.changeNotUnderstood };
    return { ok: true, field: 'amountCents', cents: amount.cents };
  }
  if (key === 'descricao') {
    if (rest.length < TX_DESCRIPTION_MIN) return { ok: false, text: TX_REPLIES.descriptionShort };
    if (rest.length > TX_DESCRIPTION_MAX) return { ok: false, text: TX_REPLIES.descriptionLong };
    return { ok: true, field: 'description', text: rest };
  }
  if (key === 'categoria') {
    if (rest.length === 0) return { ok: false, text: TX_REPLIES.changeNotUnderstood };
    return { ok: true, field: 'categoryName', query: rest };
  }
  if (key === 'data') {
    const date = parseDateToken(rest, today);
    if (date === null) return { ok: false, text: TX_REPLIES.changeNotUnderstood };
    if (date.kind === 'INVALID') return { ok: false, text: TX_REPLIES.dateInvalid };
    return { ok: true, field: 'date', ymd: date.ymd };
  }
  return { ok: false, text: TX_REPLIES.changeNotUnderstood };
}

export function describeCandidate(candidate: TxCandidate): string {
  return `${formatCents(candidate.amountCents)} · ${candidate.description}`;
}

/** Linha da lista numerada: "1) 50,00 · Mercado · 18/11". */
export function formatCandidateLine(index: number, candidate: TxCandidate): string {
  const category = candidate.categoryName ? ` · ${candidate.categoryName}` : '';
  return `${index + 1}) ${formatCents(candidate.amountCents)} · ${candidate.description}${category} · ${formatDayMonth(candidate.date)}`;
}

/** Linha compacta da lista dos ultimos: "1. 26/11 · Padaria · R$ 3,00". */
export function formatCompactLine(index: number, candidate: TxCandidate): string {
  return `${index + 1}. ${formatDayMonth(candidate.date)} · ${candidate.description} · R$ ${formatCents(candidate.amountCents)}`;
}

/** Rascunho de apagar (lançamento, meta ou reserva): a confirmação só vale com a palavra "apagar" ou a flag do cartão. */
export function isDeleteChange(draft: unknown): boolean {
  const value = draft as { kind?: string; action?: string } | null;
  const kind = value?.kind ?? '';
  return (
    kind === 'TRANSACTION_CHANGE' ||
    kind === 'GOAL_CHANGE' ||
    kind === 'ENVELOPE_CHANGE' ||
    kind === 'RECURRING_CHANGE' ||
    kind === 'INSTALLMENT_CHANGE'
  ) && value?.action === 'DELETE';
}

export function isTransactionChangeDraft(draft: unknown): draft is TransactionChangeDraft {
  return (draft as { kind?: string } | null)?.kind === 'TRANSACTION_CHANGE';
}
