import { AssistantReply, SelahResponse } from '../assistant.types';
import { normalizeConfidence, readStringList } from '../parsing/readers';
import { ASSISTANT_REPLY_LIST_LIMIT } from '../assistant.constants';

export function normalizeSelahReply(payload: SelahResponse): AssistantReply | null {
  const answer =
    typeof payload.answer === "string" ? payload.answer.trim() : "";

  if (!answer) {
    return null;
  }

  return {
    answer,
    highlights: readStringList(
      payload.highlights,
      ASSISTANT_REPLY_LIST_LIMIT,
    ),
    suggestedActions: readStringList(
      payload.suggestedActions,
      ASSISTANT_REPLY_LIST_LIMIT,
    ),
    actions: [],
    proactiveSignals: [],
    simulations: [],
    continuity: {
      historyCount: 0,
      memorySummary: null,
      nextQuestion: null,
      followUpPrompt:
        typeof payload.followUpPrompt === "string" &&
        payload.followUpPrompt.trim()
          ? payload.followUpPrompt.trim()
          : null,
      originModule: null,
    },
    explainability: {
      reasoning: readStringList(payload.reasoning, 4),
      evidence: readStringList(payload.evidence, 5),
      confidenceReason:
        typeof payload.confidenceReason === "string" &&
        payload.confidenceReason.trim()
          ? payload.confidenceReason.trim()
          : "",
    },
    source: "selah_ia",
    provider:
      typeof payload.provider === "string" && payload.provider.trim()
        ? payload.provider.trim()
        : "SelahIA",
    focusArea:
      typeof payload.focusArea === "string" && payload.focusArea.trim()
        ? payload.focusArea.trim()
        : "Visao geral",
    confidence: normalizeConfidence(payload.confidence),
    disclaimer:
      typeof payload.disclaimer === "string" && payload.disclaimer.trim()
        ? payload.disclaimer.trim()
        : null,
    generatedAt:
      typeof payload.generatedAt === "string" && payload.generatedAt.trim()
        ? payload.generatedAt.trim()
        : new Date().toISOString(),
    model:
      typeof payload.model === "string" && payload.model.trim()
        ? payload.model.trim()
        : undefined,
  };
}
