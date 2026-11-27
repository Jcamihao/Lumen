import { AssistantModule, DashboardSummary } from '../assistant.types';
import { AskAssistantHistoryItemDto } from '../dto/ask-assistant.dto';
import { detectIntent } from '../question/intent';
import { contextFields } from './payload/context-fields';
import { financeFields } from './payload/finance-fields';
import { goalItems } from './payload/goal-items';
import { insightItems } from './payload/insight-items';
import { reminderLabels, notificationLabels } from './payload/label-items';
import { profileFields } from './payload/profile-fields';
import { questionFields } from './payload/question-fields';
import { openTaskItems, taskCountFields } from './payload/task-fields';
import { transactionItems } from './payload/transaction-items';

export function buildSelahPayload(
  summary: DashboardSummary,
  question: string,
  history: AskAssistantHistoryItemDto[],
  originModule: AssistantModule,
) {
  const intent = detectIntent(question);
  return {
    ...questionFields(summary, question, intent),
    ...profileFields(summary),
    ...contextFields(summary, intent, history, originModule),
    ...taskCountFields(summary),
    ...financeFields(summary),
    openTasks: openTaskItems(summary),
    recentTransactions: transactionItems(summary),
    activeGoals: goalItems(summary),
    activeInsights: insightItems(summary),
    reminderLabels: reminderLabels(summary),
    notificationLabels: notificationLabels(summary),
  };
}
