import { DashboardSummary } from '../../assistant.types';
import { detectIntent } from '../../question/intent';
import { buildQuestionContextSummary, matchQuestionTargets } from '../../question/question-context';
import { sanitizeExternalText } from '../../text/sanitize';

export function questionFields(summary: DashboardSummary, question: string, intent: ReturnType<typeof detectIntent>) {
  return {
    message: sanitizeExternalText(question),
    intent,
    questionContextSummary: buildQuestionContextSummary(summary, question),
    matchedQuestionTargets: matchQuestionTargets(summary, question),
  };
}
