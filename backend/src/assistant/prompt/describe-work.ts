import { DashboardSummary } from '../assistant.types';
import { formatCurrency, formatDate, formatDateTime, formatEnumLabel } from '../format/format-values';
import { sanitizeExternalText } from '../text/sanitize';

export function describeTasks(
  tasks: DashboardSummary["tasks"]["items"],
  currency: string,
) {
  if (!tasks.length) {
    return "Tarefas abertas relevantes: nenhuma tarefa prioritaria aberta foi enviada.";
  }

  return `Tarefas abertas relevantes:\n- ${tasks
    .map((task) => {
      const dueDate = task.dueDate
        ? `vence ${formatDate(task.dueDate)}`
        : "sem prazo definido";
      const priority = task.priority
        ? `prioridade ${formatEnumLabel(task.priority)}`
        : "prioridade nao informada";
      const category = task.category?.name
        ? `categoria ${sanitizeExternalText(task.category.name)}`
        : "sem categoria";
      const financialImpact =
        task.hasFinancialImpact &&
        task.estimatedAmount !== null &&
        task.estimatedAmount !== undefined
          ? `impacto estimado ${formatCurrency(Number(task.estimatedAmount), currency)}`
          : task.hasFinancialImpact
            ? "com impacto financeiro"
            : "sem impacto financeiro direto";

      return `${sanitizeExternalText(task.title)} | ${priority} | ${dueDate} | ${category} | ${financialImpact}`;
    })
    .join("\n- ")}`;
}

export function describeReminders(reminders: DashboardSummary["reminders"]) {
  if (!reminders.length) {
    return "Lembretes proximos: nenhum lembrete agendado enviado.";
  }

  return `Lembretes proximos:\n- ${reminders
    .map(
      (reminder) =>
        `${sanitizeExternalText(reminder.title)} em ${formatDateTime(reminder.remindAt)}`,
    )
    .join("\n- ")}`;
}

export function describeNotifications(
  notifications: DashboardSummary["notifications"],
) {
  if (!notifications.length) {
    return "Notificacoes abertas: nenhuma notificacao aberta enviada.";
  }

  return `Notificacoes abertas:\n- ${notifications
    .map(
      (notification) =>
        `${sanitizeExternalText(notification.title)}: ${sanitizeExternalText(notification.message)}`,
    )
    .join("\n- ")}`;
}
