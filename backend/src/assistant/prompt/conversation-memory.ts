import { AskAssistantHistoryItemDto } from "../dto/ask-assistant.dto";
import { sanitizeExternalText } from '../text/sanitize';

export function buildConversationMemory(history: AskAssistantHistoryItemDto[]) {
  const recentHistory = history
    .slice(0, 3)
    .map((item, index) => {
      const question = sanitizeExternalText(item.question);
      const answer = sanitizeExternalText(item.answer).slice(0, 160);
      const focusArea = item.focusArea ? ` foco ${item.focusArea}` : "";
      return `${index + 1}. Pergunta:${focusArea} ${question}. Resposta anterior: ${answer}.`;
    })
    .filter(Boolean);

  if (!recentHistory.length) {
    return null;
  }

  return recentHistory.join(" ");
}
