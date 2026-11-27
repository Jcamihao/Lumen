import { DashboardSummary } from '../../assistant.types';
import { formatEnumLabel } from '../../format/format-values';
import { sanitizeExternalText } from '../../text/sanitize';

export function insightItems(summary: DashboardSummary) {
  return summary.insights.slice(0, 5).map((insight) => ({
    type: formatEnumLabel(insight.type),
    severity: formatEnumLabel(insight.severity),
    message: sanitizeExternalText(insight.message),
  }));
}
