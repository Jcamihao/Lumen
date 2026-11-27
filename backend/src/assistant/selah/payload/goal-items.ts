import { DashboardSummary } from '../../assistant.types';
import { formatDate, formatEnumLabel, goalProgress } from '../../format/format-values';
import { sanitizeExternalText } from '../../text/sanitize';

export function goalItems(summary: DashboardSummary) {
  return summary.goals.slice(0, 4).map((goal) => ({
    title: sanitizeExternalText(goal.title),
    status: formatEnumLabel(goal.status),
    progressPercent: goalProgress(goal),
    targetDateLabel: formatDate(goal.targetDate),
  }));
}
