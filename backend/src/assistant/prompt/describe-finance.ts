import { DashboardSummary } from '../assistant.types';
import { formatCurrency, formatDate, formatEnumLabel, goalProgress } from '../format/format-values';
import { sanitizeExternalText } from '../text/sanitize';

export function describeTransactions(
  transactions: DashboardSummary["finances"]["recentTransactions"],
  currency: string,
) {
  if (!transactions.length) {
    return "Movimentacoes recentes: nenhuma transacao recente enviada.";
  }

  return `Movimentacoes recentes:\n- ${transactions
    .map((transaction) => {
      const type = formatEnumLabel(transaction.type);
      const category = transaction.category?.name
        ? sanitizeExternalText(transaction.category.name)
        : "sem categoria";
      return `${sanitizeExternalText(transaction.description)} | ${type} | ${formatCurrency(Number(transaction.amount), currency)} | ${formatDate(transaction.date)} | ${category}`;
    })
    .join("\n- ")}`;
}

export function describeGoals(goals: DashboardSummary["goals"], currency: string) {
  if (!goals.length) {
    return "Metas em andamento: nenhuma meta ativa foi enviada.";
  }

  return `Metas em andamento:\n- ${goals
    .map((goal) => {
      const targetDate = goal.targetDate
        ? `data alvo ${formatDate(goal.targetDate)}`
        : "sem data alvo";
      // Meta sem valor-alvo (cofrinho sem proposito): nao ha "progresso %" real.
      const progress =
        goal.targetAmount === null
          ? `guardado ${formatCurrency(goal.currentAmount, currency)} (sem valor-alvo)`
          : `progresso ${goalProgress(goal)}%`;
      return `${sanitizeExternalText(goal.title)} | status ${formatEnumLabel(goal.status)} | ${progress} | ${targetDate}`;
    })
    .join("\n- ")}`;
}
