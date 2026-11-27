import { DashboardSummary } from '../../assistant.types';
import { formatDateTime } from '../../format/format-values';
import { sanitizeExternalText } from '../../text/sanitize';

export function reminderLabels(summary: DashboardSummary) {
  return summary.reminders
    .slice(0, 4)
    .map(
      (reminder) =>
        `${sanitizeExternalText(reminder.title)} em ${formatDateTime(reminder.remindAt)}`,
    );
}

export function notificationLabels(summary: DashboardSummary) {
  return summary.notifications
    .slice(0, 4)
    .map(
      (notification) =>
        `${sanitizeExternalText(notification.title)}: ${sanitizeExternalText(notification.message)}`,
    );
}
