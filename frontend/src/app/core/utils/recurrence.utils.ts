import { RecurrenceFrequency, RecurringTransaction } from '../models/domain.models';

export type RecurringStatus = 'active' | 'paused' | 'ended';

const FREQUENCY_NAMES: Record<RecurrenceFrequency, string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Datas de conta fixa sao "so data" em UTC; ler com getUTC* evita cair no dia anterior. */
function parseDue(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function frequencyName(frequency: RecurrenceFrequency) {
  return FREQUENCY_NAMES[frequency];
}

/** "Todo mês, dia 5", "Toda segunda", "Todo ano, 5 de março". */
export function recurrenceLabel(
  item: Pick<RecurringTransaction, 'frequency' | 'anchorDay' | 'nextDueDate'>,
) {
  const due = parseDue(item.nextDueDate);

  switch (item.frequency) {
    case 'WEEKLY':
      return `Toda ${WEEKDAYS[due.getUTCDay()]}`;
    case 'YEARLY':
      return `Todo ano, ${item.anchorDay} de ${MONTHS[due.getUTCMonth()]}`;
    default:
      return `Todo mês, dia ${item.anchorDay}`;
  }
}

/** 05/10/2026, sem sofrer com o fuso do navegador. */
export function dueDateLabel(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Ativa, pausada pelo usuario ou encerrada (passou da data final: o servidor
 * desativa a conta sozinho depois do ultimo vencimento).
 */
export function recurringStatus(
  item: Pick<RecurringTransaction, 'isActive' | 'nextDueDate' | 'endDate'>,
): RecurringStatus {
  if (item.isActive) {
    return 'active';
  }

  return item.endDate && item.nextDueDate.slice(0, 10) > item.endDate.slice(0, 10)
    ? 'ended'
    : 'paused';
}

/** Dias inteiros ate o vencimento, contados no calendario local do usuario. */
export function daysUntilDue(nextDueDate: string, today = new Date()) {
  const due = parseDue(nextDueDate).getTime();
  const localToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  return Math.round((due - localToday) / 86_400_000);
}
