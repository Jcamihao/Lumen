import { AssistantAction, AssistantModule, AssistantProactiveSignal } from './assistant-action.types';

export type AssistantConfidence = "low" | "medium" | "high";

/**
 * Analise real de transacoes dos ultimos 3 meses, calculada uma vez em
 * ask() e reusada em buildSimulations — troca os fixos "10% de corte" e
 * "8 meses de parcela" por numeros baseados no historico de cada usuario.
 */
export type SpendingAnalysis = {
  topVariableCategory: { name: string; total: number } | null;
  avgMonthlySurplus: number | null;
};

export type AssistantSimulation = {
  id: string;
  title: string;
  summary: string;
  monthlyDelta: number;
  projectedBalance: number;
  confidence: AssistantConfidence;
  assumptions: string[];
};

export type AssistantContinuity = {
  historyCount: number;
  memorySummary: string | null;
  nextQuestion: string | null;
  followUpPrompt: string | null;
  originModule: AssistantModule | null;
};

export type AssistantExplainability = {
  reasoning: string[];
  evidence: string[];
  confidenceReason: string;
};

export type AssistantPulse = {
  summary: string;
  suggestedQuestion: string;
  generatedAt: string;
  signals: AssistantProactiveSignal[];
  actions: AssistantAction[];
};

export type AssistantReply = {
  answer: string;
  highlights: string[];
  suggestedActions: string[];
  actions: AssistantAction[];
  proactiveSignals: AssistantProactiveSignal[];
  simulations: AssistantSimulation[];
  continuity: AssistantContinuity;
  explainability: AssistantExplainability;
  source: "selah_ia" | "lumen_fallback";
  provider: string;
  focusArea: string;
  confidence: AssistantConfidence;
  disclaimer: string | null;
  generatedAt: string;
  model?: string;
};

export type AssistantFallbackOutcome =
  | { status: "answered"; text: string }
  | { status: "blocked_by_plan" }
  | { status: "no_consent" }
  | { status: "unavailable" };
