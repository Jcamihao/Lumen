import { AssistantReply, DashboardSummary } from '../assistant.types';
import { summaryCurrency } from '../format/format-values';
import { detectIntent, resolveFocusArea } from '../question/intent';
import { localAnswer } from './local/local-answer';
import { localSuggestedActions } from './local/local-actions';
import { emptyLocalSections } from './local/local-empty-sections';
import { localHighlights } from './local/local-highlights';

export function buildLocalReply(
  summary: DashboardSummary,
  question: string,
  disclaimer: string | null,
): AssistantReply {
  const intent = detectIntent(question);
  const currency = summaryCurrency(summary);
  return {
    answer: localAnswer(summary, intent, currency),
    highlights: localHighlights(summary, currency),
    suggestedActions: localSuggestedActions(summary),
    ...emptyLocalSections(),
    source: "lumen_fallback",
    provider: "LUMEN Local",
    focusArea: resolveFocusArea(intent),
    confidence: "medium",
    disclaimer,
    generatedAt: new Date().toISOString(),
  };
}
