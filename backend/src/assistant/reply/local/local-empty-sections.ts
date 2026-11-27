import { AssistantReply } from '../../assistant.types';

/** Secoes que o fallback local nao preenche; objetos novos a cada chamada para nao compartilhar referencia. */
export function emptyLocalSections(): Pick<
  AssistantReply,
  "actions" | "proactiveSignals" | "simulations" | "continuity" | "explainability"
> {
  return {
    actions: [],
    proactiveSignals: [],
    simulations: [],
    continuity: {
      historyCount: 0,
      memorySummary: null,
      nextQuestion: null,
      followUpPrompt: null,
      originModule: null,
    },
    explainability: {
      reasoning: [],
      evidence: [],
      confidenceReason: "",
    },
  };
}
