import { AssistantModule, DashboardSummary } from '../../assistant.types';
import { AskAssistantHistoryItemDto } from '../../dto/ask-assistant.dto';
import { buildApplicationPromptContext } from '../../prompt/application-prompt-context';
import { buildConversationMemory } from '../../prompt/conversation-memory';
import { buildLifeContextSummary } from '../../prompt/life-context-summary';
import { detectIntent, resolveFocusArea } from '../../question/intent';

export function contextFields(
  summary: DashboardSummary,
  intent: ReturnType<typeof detectIntent>,
  history: AskAssistantHistoryItemDto[],
  originModule: AssistantModule,
) {
  return {
    lifeContextSummary: buildLifeContextSummary(summary),
    applicationPromptContext: buildApplicationPromptContext(summary, intent),
    conversationMemory: buildConversationMemory(history),
    originModule,
    focusAreaHint: resolveFocusArea(intent),
  };
}
