import { DashboardSummary } from '../../assistant.types';
import { formatDate, formatEnumLabel } from '../../format/format-values';
import { sanitizeExternalText } from '../../text/sanitize';
import { categoryLabel } from './category-label';

export function transactionItems(summary: DashboardSummary) {
  return summary.finances.recentTransactions.slice(0, 5).map((transaction) => ({
    description: sanitizeExternalText(transaction.description),
    type: formatEnumLabel(transaction.type),
    amount: Number(transaction.amount),
    dateLabel: formatDate(transaction.date),
    category: categoryLabel(transaction.category),
  }));
}
