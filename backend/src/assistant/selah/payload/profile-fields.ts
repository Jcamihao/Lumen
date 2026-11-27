import { DashboardSummary } from '../../assistant.types';
import { summaryCurrency } from '../../format/format-values';
import { extractFirstName } from '../../text/sanitize';

export function profileFields(summary: DashboardSummary) {
  return {
    currentDateLabel: formatCurrentDateLabel(),
    user: {
      name: extractFirstName(summary.user.name),
      preferredCurrency: summaryCurrency(summary),
      monthlyIncome: summary.user.monthlyIncome,
    },
  };
}

function formatCurrentDateLabel() {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date());
}
