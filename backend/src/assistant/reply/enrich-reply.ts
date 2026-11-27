import { AssistantModule, AssistantReply, DashboardSummary, SpendingAnalysis } from '../assistant.types';
import { AskAssistantHistoryItemDto } from "../dto/ask-assistant.dto";
import { detectIntent, resolveFocusArea } from '../question/intent';
import { buildContinuity } from './continuity';
import { buildActionSuggestions } from './action-suggestions';
import { buildProactiveSignals } from './proactive-signals';
import { buildSimulations } from './simulations';
import { buildExplainability } from './explainability';

export function enrichReply(
  summary: DashboardSummary,
  question: string,
  reply: AssistantReply,
  history: AskAssistantHistoryItemDto[],
  originModule: AssistantModule,
  generatedAt: string,
  spendingAnalysis: SpendingAnalysis,
): AssistantReply {
  const focusArea = reply.focusArea || resolveFocusArea(detectIntent(question));
  const continuity = buildContinuity(
    summary,
    question,
    reply,
    history,
    originModule,
  );

  return {
    ...reply,
    generatedAt: reply.generatedAt || generatedAt,
    actions: buildActionSuggestions(summary, question, originModule, focusArea),
    proactiveSignals: buildProactiveSignals(summary, question, originModule),
    simulations: buildSimulations(summary, question, spendingAnalysis),
    continuity,
    explainability: buildExplainability(summary, question, reply, continuity),
  };
}
