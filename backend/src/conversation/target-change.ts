import { AmountFailure, parseAmountPrefix } from './parsers/amount.parser';
import { parseDateToken } from './parsers/date.parser';
import { normalize, normalizeWord } from './parsers/normalize';
import { GOAL_TITLE_MAX, GOAL_TITLE_MIN } from './parsers/goal.parser';
import type { InstallmentCandidate, RecurringCandidate } from './recurring-change';
import { TargetChangeDraft } from './conversation.types';
import { TX_REPLIES, formatCents } from './transaction-change';

/**
 * Editar e apagar metas e reservas por conversa (contrato 8b). Funções puras: sem banco, sem Nest.
 * Segue o padrão do 8a (transaction-change.ts); o que muda é o alvo e o vocabulário.
 */

/** Lista numerada igual à do 8a: até 5 candidatos (contrato 8b, secao 3). */
export const TARGET_CHANGE_MAX_CANDIDATES = 5;
/** Lista de metas ao editar/apagar sem termo (menu guiado): ate 10, mais recentes primeiro. */
export const TARGET_LIST_MAX = 10;
/** Limites de nome/título: os mesmos dos DTOs da tela (Goal.title e Envelope.name). */
export const TARGET_NAME_MIN = GOAL_TITLE_MIN;
export const TARGET_NAME_MAX = GOAL_TITLE_MAX;

export const TG_REPLIES = {
  askWhichGoal: 'Qual meta? Diga parte do nome. Ex.: apagar meta viagem',
  askWhichEnvelope: 'Qual reserva? Diga parte do nome. Ex.: apagar reserva gasolina',
  pickHeaderGoal: 'Qual meta? Responda com o número:',
  goalListMore: 'Tem mais metas. Para achar outra, responda cancelar e diga parte do nome. Ex.: apagar meta viagem',
  goalListEmpty: 'Você ainda não tem metas. Crie a primeira em Menu → Metas → Criar meta.',
  pickHeaderEnvelope: 'Qual reserva? Responda com o número:',
  askChangeGoal: 'O que mudar? título, valor 500, sem alvo ou prazo 20/12. Ex.: valor 800',
  askChangeEnvelope: 'O que mudar? nome padaria ou valor mensal 150. Ex.: valor mensal 150',
  goalNotFound: 'Não achei meta com isso.',
  envelopeNotFound: 'Não achei reserva com isso.',
  goalGone: 'Não encontrei mais essa meta.',
  envelopeGone: 'Não encontrei mais essa reserva.',
  goalChanged: 'Essa meta mudou desde que você escolheu; refaça a busca.',
  envelopeChanged: 'Essa reserva mudou desde que você escolheu; refaça a busca.',
  changeNotUnderstoodGoal: 'Não entendi a mudança. Use: título viagem, valor 800, sem alvo ou prazo 20/12.',
  changeNotUnderstoodEnvelope: 'Não entendi a mudança. Use: nome gasolina ou valor mensal 150.',
  nameShort: `O nome precisa ter pelo menos ${TARGET_NAME_MIN} letras.`,
  nameLong: `O nome passou de ${TARGET_NAME_MAX} letras. Use um texto menor.`,
  dateInvalid: 'Esse prazo não existe. Use dd/mm, dd/mm/aaaa ou mm/aaaa, ex.: 20/12.',
  /** Apagar mantém a semântica da tela (decisões 1 e 4 do dono): aportes e gastos ficam soltos no extrato. */
  goalDeleteNote: 'Os aportes já feitos continuam no extrato, soltos.',
  envelopeDeleteNote: 'Os depósitos dessa reserva somem; os gastos ligados continuam no extrato, soltos.',
  envelopeAmountNote: 'O valor mensal novo vale a partir do próximo depósito.',
  /** Vem do 8a (contrato 8b, secao 6): mesma confirmação reforçada. */
  deleteWarning: TX_REPLIES.deleteWarning,
  deleteNeedsWord: TX_REPLIES.deleteNeedsWord,
  nothingToChange: TX_REPLIES.nothingToChange,
  editConfirm: TX_REPLIES.editConfirm,
} as const;

/** Meta candidata, em centavos, com updatedAt para o conflito (todos os status, contrato 8b, secao 3). */
export interface GoalCandidate {
  id: string;
  title: string;
  status: 'PLANNED' | 'ACTIVE' | 'ACHIEVED' | 'PAUSED';
  targetCents: number | null;
  currentCents: number;
  /** 'AAAA-MM-DD' ou null (sem prazo). */
  targetDate: string | null;
  updatedAt: Date;
}

/** Reserva candidata (nome único por usuário). */
export interface EnvelopeCandidate {
  id: string;
  name: string;
  monthlyCents: number;
  isActive: boolean;
  updatedAt: Date;
}

export type TargetCandidate =
  | { target: 'GOAL'; goal: GoalCandidate }
  | { target: 'ENVELOPE'; envelope: EnvelopeCandidate }
  | { target: 'RECURRING'; recurring: RecurringCandidate }
  | { target: 'INSTALLMENT'; installment: InstallmentCandidate };

/** Status da meta em português (lista, prévia e recibo — contrato 8b, secao 3). */
export const STATUS_PT: Record<GoalCandidate['status'], string> = {
  PLANNED: 'planejada',
  ACTIVE: 'ativa',
  ACHIEVED: 'concluída',
  PAUSED: 'pausada',
};

/** 'AAAA-MM-DD' vira 'dd/mm/aaaa'. */
export function formatDateFull(ymd: string): string {
  return ymd.split('-').reverse().join('/');
}

/** Linha da lista numerada de metas: "1) Viagem · ativa · 300,00 de 500,00 · prazo 12/2026". */
export function formatGoalLine(index: number, goal: GoalCandidate): string {
  const progress =
    goal.targetCents === null
      ? `guardado ${formatCents(goal.currentCents)} (sem alvo)`
      : `${formatCents(goal.currentCents)} de ${formatCents(goal.targetCents)}`;
  const prazo = goal.targetDate === null ? '' : ` · prazo ${formatDateFull(goal.targetDate)}`;
  return `${index + 1}) ${goal.title} · ${STATUS_PT[goal.status]} · ${progress}${prazo}`;
}

/** Linha da lista numerada de reservas: "1) Gasolina · 200,00/mês · ativa". */
export function formatEnvelopeLine(index: number, envelope: EnvelopeCandidate): string {
  return `${index + 1}) ${envelope.name} · ${formatCents(envelope.monthlyCents)}/mês · ${
    envelope.isActive ? 'ativa' : 'pausada'
  }`;
}

export function describeGoal(goal: GoalCandidate): string {
  const alvo = goal.targetCents === null ? 'sem alvo' : `alvo ${formatCents(goal.targetCents)}`;
  return `${goal.title} · ${formatCents(goal.currentCents)} guardados · ${alvo}`;
}

export function describeEnvelope(envelope: EnvelopeCandidate): string {
  return `${envelope.name} · ${formatCents(envelope.monthlyCents)}/mês`;
}

/** Casa termo (sem acento e caixa) com o nome do alvo. Reservas têm nome único; metas podem repetir. */
export function matchesName(name: string, term: string): boolean {
  return normalize(name).includes(term);
}

/**
 * Mudança pedida em uma mensagem (contrato 8b, secao 5). Meta: título/valor/sem alvo/prazo/sem prazo.
 * Reserva: nome/valor mensal. Uma mudança por mensagem, como no 8a.
 */
export type TargetChangeParse =
  | { ok: true; field: 'title' | 'name'; text: string }
  | { ok: true; field: 'targetCents'; cents: number | null }
  | { ok: true; field: 'targetDate'; ymd: string | null }
  | { ok: true; field: 'monthlyCents'; cents: number }
  | { ok: false; text: string };

export function parseTargetChange(
  kind: 'GOAL_CHANGE' | 'ENVELOPE_CHANGE',
  value: string,
  today: string,
  amountError: (reason: AmountFailure) => string,
): TargetChangeParse {
  const trimmed = value.trim();
  const phrase = normalize(trimmed);
  if (kind === 'GOAL_CHANGE') {
    if (phrase === 'sem alvo') return { ok: true, field: 'targetCents', cents: null };
    if (phrase === 'sem prazo') return { ok: true, field: 'targetDate', ymd: null };
  }
  const space = trimmed.search(/\s/);
  const key = normalizeWord(space === -1 ? trimmed : trimmed.slice(0, space));
  let rest = space === -1 ? '' : trimmed.slice(space).trim();

  if (kind === 'ENVELOPE_CHANGE') {
    if (key === 'nome') return parseName(rest, TG_REPLIES.changeNotUnderstoodEnvelope);
    // "valor 150" e "valor mensal 150" significam a mesma coisa em reserva.
    if (key === 'valor' && normalizeWord(rest.split(/\s+/)[0] ?? '') === 'mensal') {
      rest = rest.split(/\s+/).slice(1).join(' ');
    }
    if (key === 'valor' || key === 'mensal') return parseAmount(rest, amountError, TG_REPLIES.changeNotUnderstoodEnvelope);
    return { ok: false, text: TG_REPLIES.changeNotUnderstoodEnvelope };
  }

  if (key === 'titulo' || key === 'nome') {
    const parsed = parseName(rest, TG_REPLIES.changeNotUnderstoodGoal);
    // Em meta o campo de nome é o título.
    return parsed.ok === true && parsed.field === 'name' ? { ok: true, field: 'title', text: parsed.text } : parsed;
  }
  if (key === 'valor' && normalizeWord(rest.split(/\s+/)[0] ?? '') === 'alvo') {
    rest = rest.split(/\s+/).slice(1).join(' ');
  }
  if (key === 'valor' || key === 'alvo') {
    const parsed = parseAmount(rest, amountError, TG_REPLIES.changeNotUnderstoodGoal);
    // Em meta o valor é o alvo.
    return parsed.ok === true && parsed.field === 'monthlyCents' ? { ok: true, field: 'targetCents', cents: parsed.cents } : parsed;
  }
  if (key === 'prazo') {
    // "prazo 12/2026" (mm/aaaa) vira o ultimo dia daquele mes; "prazo 20/12" segue o parser do 8a.
    const monthYear = /^(\d{1,2})\/(\d{4})$/.exec(rest.trim());
    if (monthYear !== null) {
      const month = Number(monthYear[1]);
      const year = Number(monthYear[2]);
      if (month < 1 || month > 12) return { ok: false, text: TG_REPLIES.dateInvalid };
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const pad = (value: number) => String(value).padStart(2, '0');
      return { ok: true, field: 'targetDate', ymd: `${year}-${pad(month)}-${pad(lastDay)}` };
    }
    const date = parseDateToken(rest, today);
    if (date === null) return { ok: false, text: TG_REPLIES.changeNotUnderstoodGoal };
    if (date.kind === 'INVALID') return { ok: false, text: TG_REPLIES.dateInvalid };
    return { ok: true, field: 'targetDate', ymd: date.ymd };
  }
  return { ok: false, text: TG_REPLIES.changeNotUnderstoodGoal };
}

function parseName(rest: string, notUnderstood: string): TargetChangeParse {
  if (rest.length === 0) return { ok: false, text: notUnderstood };
  if (rest.length < TARGET_NAME_MIN) return { ok: false, text: TG_REPLIES.nameShort };
  if (rest.length > TARGET_NAME_MAX) return { ok: false, text: TG_REPLIES.nameLong };
  return { ok: true, field: 'name', text: rest };
}

function parseAmount(
  rest: string,
  amountError: (reason: AmountFailure) => string,
  notUnderstood: string,
): TargetChangeParse {
  const amount = parseAmountPrefix(rest);
  if (amount.ok === false) return { ok: false, text: amountError(amount.reason) };
  if (amount.rest.trim().length > 0) return { ok: false, text: notUnderstood };
  return { ok: true, field: 'monthlyCents', cents: amount.cents };
}

export function isTargetChangeDraft(draft: unknown): draft is TargetChangeDraft {
  const kind = (draft as { kind?: string } | null)?.kind;
  return kind === 'GOAL_CHANGE' || kind === 'ENVELOPE_CHANGE' || kind === 'RECURRING_CHANGE' || kind === 'INSTALLMENT_CHANGE';
}
