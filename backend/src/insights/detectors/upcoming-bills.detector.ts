import { InsightSeverity, InsightType } from '@prisma/client';
import { UPCOMING_BILL_WINDOW_DAYS } from '../context/context-limits';
import { InsightContext, UpcomingBill } from '../context/insight-context.types';
import { formatAmount } from '../format-amount';
import { GeneratedInsight } from '../insight.types';
import { hashSubject } from '../insight-identity';

const MAX_LISTED = 3;

const when = (days: number): string => (days === 1 ? 'amanha' : `em ${days} dias`);

function billsMessage(bills: UpcomingBill[], currency: string): string {
  const nearest = bills[0];
  const label = (bill: UpcomingBill) => `${bill.description} (${formatAmount(bill.amount, currency)})`;
  if (bills.length === 1) {
    return `${label(nearest)} vence ${when(nearest.daysUntil)}. O lancamento entra sozinho no dia; vale garantir o saldo.`;
  }
  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
  const listed = bills.slice(0, MAX_LISTED).map(label).join(', ');
  const more = bills.length - MAX_LISTED;
  return `${bills.length} contas fixas vencem nos proximos ${UPCOMING_BILL_WINDOW_DAYS} dias, somando ${formatAmount(total, currency)}: ${listed}${more > 0 ? ` e mais ${more}` : ''}. A primeira vence ${when(nearest.daysUntil)}.`;
}

/**
 * Contas fixas de despesa que vencem nos proximos dias. Um unico insight
 * agrupa todas (mais proximas primeiro): varias contas na mesma semana e uma
 * situacao so, e evita inundar o painel. Amanha vira WARNING; antes disso e
 * so um aviso informativo.
 */
export function detectUpcomingBills(context: InsightContext): GeneratedInsight | null {
  const bills = context.upcomingBills;
  if (bills.length === 0) return null;

  const nearest = bills[0];
  return {
    type: InsightType.FINANCE,
    key: `upcoming_bills:${hashSubject(bills.map((bill) => `${bill.id}@${bill.dueDate.toISOString()}`))}`,
    severity: nearest.daysUntil <= 1 ? InsightSeverity.WARNING : InsightSeverity.INFO,
    message: billsMessage(bills, context.user.preferredCurrency),
    metadata: {
      count: bills.length,
      total: bills.reduce((sum, bill) => sum + bill.amount, 0),
      nearestDays: nearest.daysUntil,
      bills: bills.slice(0, MAX_LISTED).map((bill) => ({
        description: bill.description,
        amount: bill.amount,
        daysUntil: bill.daysUntil,
      })),
    },
  };
}
