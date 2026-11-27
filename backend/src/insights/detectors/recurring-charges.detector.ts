import { InsightSeverity, InsightType } from '@prisma/client';
import { differenceInCalendarDays } from 'date-fns';
import { InsightContext } from '../context/insight-context.types';
import { formatAmount } from '../format-amount';
import { ChargeOccurrence, GeneratedInsight } from '../insight.types';
import { hashSubject } from '../insight-identity';
import { collapseToUniqueDays, groupChargesByFingerprint } from './charge-grouping';

/** Intervalo aceito entre ocorrencias para considerar a cobranca mensal. */
const MONTHLY_GAP_MIN_DAYS = 25;
const MONTHLY_GAP_MAX_DAYS = 35;
const MIN_OCCURRENCES_FOR_SUBSCRIPTION = 3;

type Subscription = { description: string; amount: number; occurrences: number; lastDate: string };

function isMonthly(days: ChargeOccurrence[]): boolean {
  return days.every((charge, index) => {
    if (index === 0) return true;
    const gap = differenceInCalendarDays(charge.date, days[index - 1].date);
    return gap >= MONTHLY_GAP_MIN_DAYS && gap <= MONTHLY_GAP_MAX_DAYS;
  });
}

function toSubscription(group: ChargeOccurrence[]): Subscription | null {
  const uniqueDays = collapseToUniqueDays(group);
  if (uniqueDays.length < MIN_OCCURRENCES_FOR_SUBSCRIPTION || !isMonthly(uniqueDays)) return null;

  const last = uniqueDays[uniqueDays.length - 1];
  return {
    description: last.description,
    amount: last.amount,
    occurrences: uniqueDays.length,
    lastDate: last.date.toISOString(),
  };
}

function subscriptionsMessage(subscriptions: Subscription[], monthlyTotal: number, currency: string): string {
  if (subscriptions.length === 1) {
    return `Identifiquei uma cobranca recorrente: ${subscriptions[0].description} de ${formatAmount(subscriptions[0].amount, currency)} por mes. Vale confirmar se ainda faz sentido manter.`;
  }
  return `Identifiquei ${subscriptions.length} cobrancas recorrentes somando ${formatAmount(monthlyTotal, currency)} por mes. Vale revisar quais ainda valem a pena.`;
}

/**
 * Assinatura recorrente: mesma descricao e mesmo valor repetindo em
 * intervalo mensal. Serve para revelar gastos fixos que passam batido.
 */
export function detectRecurringCharges(context: InsightContext): GeneratedInsight | null {
  const subscriptions = groupChargesByFingerprint(context.recentExpenses)
    .map(toSubscription)
    .filter((entry): entry is Subscription => entry !== null);
  if (subscriptions.length === 0) return null;

  const monthlyTotal = subscriptions.reduce((total, subscription) => total + subscription.amount, 0);
  return {
    type: InsightType.FINANCE,
    key: `recurring_charges:${hashSubject(subscriptions.map((entry) => `${entry.description}:${entry.amount}`))}`,
    severity: InsightSeverity.INFO,
    message: subscriptionsMessage(subscriptions, monthlyTotal, context.user.preferredCurrency),
    metadata: { subscriptions, monthlyTotal },
  };
}
