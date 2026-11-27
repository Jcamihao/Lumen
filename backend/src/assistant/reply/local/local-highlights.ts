import { DashboardSummary } from '../../assistant.types';
import { formatCurrency, goalProgress } from '../../format/format-values';
import { ensureHighlights } from '../reply-lists';
import { criticalInsightsOf, goalsOf } from './local-context';

export function localHighlights(summary: DashboardSummary, currency: string) {
  return ensureHighlights([
    ...criticalInsightsOf(summary).map((insight) => insight.message),
    ...goalsOf(summary).map((goal) => goalHighlight(goal, currency)),
  ]);
}

function goalHighlight(goal: DashboardSummary['goals'][number], currency: string) {
  return goal.targetAmount === null
    ? `Meta ${goal.title}: ${formatCurrency(goal.currentAmount, currency)} guardados (sem valor-alvo).`
    : `Meta ${goal.title}: ${goalProgress(goal)}% concluida.`;
}
