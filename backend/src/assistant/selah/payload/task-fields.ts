import { DashboardSummary } from '../../assistant.types';
import { formatDate, formatEnumLabel } from '../../format/format-values';
import { sanitizeExternalText } from '../../text/sanitize';
import { categoryLabel } from './category-label';

export function taskCountFields(summary: DashboardSummary) {
  return {
    tasksTodayCount: summary.tasks.todayCount,
    tasksOverdueCount: summary.tasks.overdueCount,
  };
}

export function openTaskItems(summary: DashboardSummary) {
  return summary.tasks.items.slice(0, 5).map((task) => ({
    title: sanitizeExternalText(task.title),
    priority: formatEnumLabel(task.priority),
    dueDateLabel: formatDate(task.dueDate),
    category: categoryLabel(task.category),
    hasFinancialImpact: Boolean(task.hasFinancialImpact),
    estimatedAmount:
      task.estimatedAmount !== null && task.estimatedAmount !== undefined
        ? Number(task.estimatedAmount)
        : undefined,
  }));
}
