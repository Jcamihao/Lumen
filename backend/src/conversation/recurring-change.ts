import { AmountFailure, parseAmountPrefix } from './parsers/amount.parser';
import { parseDateToken } from './parsers/date.parser';
import { normalize, normalizeWord } from './parsers/normalize';
import { formatCents, TX_REPLIES } from './transaction-change';

/**
 * Editar e apagar contas fixas e compras parceladas por conversa (contrato 8c). Funções puras:
 * sem banco, sem Nest. Mesma máquina dos 8a/8b (target-change.ts); muda o alvo e o vocabulário.
 */

/** Limites da descrição: os do DTO da tela (UpdateRecurringTransactionDto: 2 a 120). */
export const RECURRING_DESC_MIN = 2;
export const RECURRING_DESC_MAX = 120;

export const RC_REPLIES = {
  askWhichRecurring: 'Qual conta fixa? Diga parte do nome. Ex.: apagar conta fixa netflix',
  askWhichInstallment: 'Qual compra parcelada? Diga parte do nome. Ex.: apagar parcelado tv',
  pickHeaderRecurring: 'Qual conta fixa? Responda com o número:',
  pickHeaderInstallment: 'Qual compra parcelada? Responda com o número:',
  askChangeRecurring: 'O que mudar? nome netflix, valor 90 ou prazo 20/12. Ex.: valor 100',
  recurringNotFound: 'Não achei conta fixa com isso.',
  installmentNotFound: 'Não achei compra parcelada com isso.',
  recurringGone: 'Não encontrei mais essa conta fixa.',
  installmentGone: 'Não encontrei mais essa compra parcelada.',
  recurringChanged: 'Essa conta fixa mudou desde que você escolheu; refaça a busca.',
  installmentChanged: 'Essa compra parcelada mudou desde que você escolheu; refaça a busca.',
  changeNotUnderstoodRecurring: 'Não entendi a mudança. Use: nome netflix, valor 100 ou prazo 20/12.',
  descShort: `O nome precisa ter pelo menos ${RECURRING_DESC_MIN} letras.`,
  descLong: `O nome passou de ${RECURRING_DESC_MAX} letras. Use um texto menor.`,
  dateInvalid: 'Essa data não existe. Use dd/mm ou dd/mm/aaaa, ex.: 20/12.',
  /** Apagar mantém a semântica da tela (D4): o que já foi gerado fica solto; o que vem depois somem. */
  recurringDeleteNote: 'Os lançamentos já gerados continuam no extrato, soltos. Os próximos não vão mais ser gerados.',
  installmentDeleteNote: 'As parcelas já geradas continuam no extrato, soltas. As que faltavam somem com a compra.',
  /** D3 do dono: parcelado no chat só apaga (nem a tela edita; editar seria apagar e recriar). */
  installmentNoEdit: 'Compra parcelada não tem edição nem na tela. Se precisar, apague e crie de novo.',
  deleteWarning: TX_REPLIES.deleteWarning,
  deleteNeedsWord: TX_REPLIES.deleteNeedsWord,
  nothingToChange: TX_REPLIES.nothingToChange,
  editConfirm: TX_REPLIES.editConfirm,
} as const;

/** Conta fixa candidata, em centavos, com updatedAt para o conflito (todos os status, contrato 8c, seção 3). */
export interface RecurringCandidate {
  id: string;
  description: string;
  amountCents: number;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  /** 'AAAA-MM-DD' do próximo vencimento (sempre existe enquanto a conta vive). */
  nextDueDate: string;
  /** 'AAAA-MM-DD' ou null (sem data final). */
  endDate: string | null;
  isActive: boolean;
  cardName: string | null;
  updatedAt: Date;
}

/** Compra parcelada candidata. A lista do chat só traz as que ainda têm parcela a gerar (contrato 8c, seção 3). */
export interface InstallmentCandidate {
  id: string;
  description: string;
  installmentCents: number;
  totalCents: number;
  installmentsTotal: number;
  installmentsGenerated: number;
  nextDueDate: string | null;
  isActive: boolean;
  cardName: string | null;
  updatedAt: Date;
}

/** Frequência em português, para a linha "55,90/mês". */
export const FREQ_PT: Record<RecurringCandidate['frequency'], string> = {
  WEEKLY: 'semana',
  MONTHLY: 'mês',
  YEARLY: 'ano',
};

/** Linha da lista numerada de contas fixas: "1) Netflix · 55,90/mês · vence 05/12/2026 · ativa". */
export function formatRecurringLine(index: number, recurring: RecurringCandidate): string {
  return `${index + 1}) ${recurring.description} · ${formatCents(recurring.amountCents)}/${
    FREQ_PT[recurring.frequency]
  } · vence ${recurring.nextDueDate.split('-').reverse().join('/')} · ${
    recurring.isActive ? 'ativa' : 'pausada'
  }`;
}

/** Linha da lista numerada de parcelados: "1) TV · 300,00 · 4 de 12 · vence 10/12/2026". */
export function formatInstallmentLine(index: number, installment: InstallmentCandidate): string {
  const next =
    installment.nextDueDate === null ? '' : ` · vence ${installment.nextDueDate.split('-').reverse().join('/')}`;
  return `${index + 1}) ${installment.description} · ${formatCents(installment.installmentCents)} · ${
    installment.installmentsGenerated
  } de ${installment.installmentsTotal}${next}`;
}

export function describeRecurring(recurring: RecurringCandidate): string {
  return `${recurring.description} · ${formatCents(recurring.amountCents)}/${FREQ_PT[recurring.frequency]}`;
}

export function describeInstallment(installment: InstallmentCandidate): string {
  return `${installment.description} · ${formatCents(installment.installmentCents)} por parcela · ${
    installment.installmentsGenerated
  } de ${installment.installmentsTotal}`;
}

/**
 * Mudança pedida em uma mensagem (contrato 8c, seção 5 — D2): descrição, valor e data final
 * ("prazo"/"data final", com "sem prazo" para tirar). Uma mudança por mensagem, como no 8a/8b.
 */
export type RecurringChangeParse =
  | { ok: true; field: 'description'; text: string }
  | { ok: true; field: 'amountCents'; cents: number }
  | { ok: true; field: 'endDate'; ymd: string | null }
  | { ok: false; text: string };

export function parseRecurringChange(
  value: string,
  today: string,
  amountError: (reason: AmountFailure) => string,
): RecurringChangeParse {
  const trimmed = value.trim();
  const phrase = normalize(trimmed);
  if (phrase === 'sem prazo' || phrase === 'sem data final') {
    return { ok: true, field: 'endDate', ymd: null };
  }
  const space = trimmed.search(/\s/);
  const key = normalizeWord(space === -1 ? trimmed : trimmed.slice(0, space));
  let rest = space === -1 ? '' : trimmed.slice(space).trim();

  if (key === 'nome' || key === 'descricao') {
    if (rest.length === 0) return { ok: false, text: RC_REPLIES.changeNotUnderstoodRecurring };
    if (rest.length < RECURRING_DESC_MIN) return { ok: false, text: RC_REPLIES.descShort };
    if (rest.length > RECURRING_DESC_MAX) return { ok: false, text: RC_REPLIES.descLong };
    return { ok: true, field: 'description', text: rest };
  }
  if (key === 'valor') {
    const amount = parseAmountPrefix(rest);
    if (amount.ok === false) return { ok: false, text: amountError(amount.reason) };
    if (amount.rest.trim().length > 0) return { ok: false, text: RC_REPLIES.changeNotUnderstoodRecurring };
    return { ok: true, field: 'amountCents', cents: amount.cents };
  }
  if (key === 'data') {
    // "data final 20/12" e "data 20/12" significam a mesma coisa.
    if (normalizeWord(rest.split(/\s+/)[0] ?? '') === 'final') {
      rest = rest.split(/\s+/).slice(1).join(' ');
    }
  }
  if (key === 'prazo' || key === 'final' || key === 'data') {
    const date = parseDateToken(rest, today);
    if (date === null) return { ok: false, text: RC_REPLIES.changeNotUnderstoodRecurring };
    if (date.kind === 'INVALID') return { ok: false, text: RC_REPLIES.dateInvalid };
    return { ok: true, field: 'endDate', ymd: date.ymd };
  }
  return { ok: false, text: RC_REPLIES.changeNotUnderstoodRecurring };
}
