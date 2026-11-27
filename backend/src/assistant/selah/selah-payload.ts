import { AssistantModule, DashboardSummary } from '../assistant.types';
import { AskAssistantHistoryItemDto } from "../dto/ask-assistant.dto";
import { formatDate, formatDateTime, formatEnumLabel, goalProgress, summaryCurrency } from '../format/format-values';
import { detectIntent, resolveFocusArea } from '../question/intent';
import { extractFirstName, sanitizeExternalText } from '../text/sanitize';
import { buildQuestionContextSummary, matchQuestionTargets } from '../question/question-context';
import { buildLifeContextSummary } from '../prompt/life-context-summary';
import { buildApplicationPromptContext } from '../prompt/application-prompt-context';
import { buildConversationMemory } from '../prompt/conversation-memory';

export function buildSelahPayload(
  summary: DashboardSummary,
  question: string,
  history: AskAssistantHistoryItemDto[],
  originModule: AssistantModule,
) {
  const currency = summaryCurrency(summary);
  const intent = detectIntent(question);
  const firstName = extractFirstName(summary.user.name);

  return {
    message: sanitizeExternalText(question),
    intent,
    questionContextSummary: buildQuestionContextSummary(summary, question),
    matchedQuestionTargets: matchQuestionTargets(summary, question),
    currentDateLabel: new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    }).format(new Date()),
    user: {
      name: firstName,
      preferredCurrency: currency,
      monthlyIncome: summary.user.monthlyIncome,
    },
    lifeContextSummary: buildLifeContextSummary(summary),
    applicationPromptContext: buildApplicationPromptContext(
      summary,
      intent,
    ),
    conversationMemory: buildConversationMemory(history),
    originModule,
    focusAreaHint: resolveFocusArea(intent),
    tasksTodayCount: summary.tasks.todayCount,
    tasksOverdueCount: summary.tasks.overdueCount,
    currentBalance: summary.finances.balance,
    monthlyExpenses: summary.finances.monthlyExpenses,
    monthlyIncome: summary.finances.monthlyIncome,
    forecast: {
      predictedBalance: Number(summary.forecast.predictedBalance ?? 0),
      riskLevel: String(summary.forecast.riskLevel || "MEDIUM"),
    },
    openTasks: summary.tasks.items.slice(0, 5).map((task) => ({
      title: sanitizeExternalText(task.title),
      priority: formatEnumLabel(task.priority),
      dueDateLabel: formatDate(task.dueDate),
      category: task.category?.name
        ? sanitizeExternalText(task.category.name)
        : undefined,
      hasFinancialImpact: Boolean(task.hasFinancialImpact),
      estimatedAmount:
        task.estimatedAmount !== null && task.estimatedAmount !== undefined
          ? Number(task.estimatedAmount)
          : undefined,
    })),
    recentTransactions: summary.finances.recentTransactions
      .slice(0, 5)
      .map((transaction) => ({
        description: sanitizeExternalText(transaction.description),
        type: formatEnumLabel(transaction.type),
        amount: Number(transaction.amount),
        dateLabel: formatDate(transaction.date),
        category: transaction.category?.name
          ? sanitizeExternalText(transaction.category.name)
          : undefined,
      })),
    activeGoals: summary.goals.slice(0, 4).map((goal) => ({
      title: sanitizeExternalText(goal.title),
      status: formatEnumLabel(goal.status),
      progressPercent: goalProgress(goal),
      targetDateLabel: formatDate(goal.targetDate),
    })),
    activeInsights: summary.insights.slice(0, 5).map((insight) => ({
      type: formatEnumLabel(insight.type),
      severity: formatEnumLabel(insight.severity),
      message: sanitizeExternalText(insight.message),
    })),
    reminderLabels: summary.reminders
      .slice(0, 4)
      .map(
        (reminder) =>
          `${sanitizeExternalText(reminder.title)} em ${formatDateTime(reminder.remindAt)}`,
      ),
    notificationLabels: summary.notifications
      .slice(0, 4)
      .map(
        (notification) =>
          `${sanitizeExternalText(notification.title)}: ${sanitizeExternalText(notification.message)}`,
      ),
  };
}
