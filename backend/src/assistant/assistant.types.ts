import { TransactionType } from "@prisma/client";

export type AssistantConfidence = "low" | "medium" | "high";

export type DashboardSummary = {
  user: {
    id?: string;
    name: string;
    preferredCurrency: string;
    monthlyIncome: number;
    birthDate?: Date | string | null;
    occupation?: string | null;
    primaryGoal?: string | null;
  };
  tasks: {
    todayCount: number;
    overdueCount: number;
    items: Array<{
      title: string;
      dueDate?: Date | string | null;
      priority?: string | null;
      hasFinancialImpact?: boolean | null;
      estimatedAmount?: number | null;
      category?: {
        name: string;
      } | null;
    }>;
  };
  finances: {
    balance: number;
    monthlyExpenses: number;
    monthlyIncome: number;
    recentTransactions: Array<{
      description: string;
      type: string;
      amount: number;
      date: Date | string;
      category?: {
        name: string;
      } | null;
    }>;
  };
  goals: Array<{
    title: string;
    currentAmount: number;
    /** null = cofrinho sem valor-alvo definido. */
    targetAmount: number | null;
    status: string;
    targetDate?: Date | string | null;
  }>;
  reminders: Array<{
    title: string;
    remindAt: Date | string;
  }>;
  insights: Array<{
    type: string;
    message: string;
    severity: string;
    /** type:key:severity, ver InsightsService.fingerprintOf */
    fingerprint?: string;
    metadata?: { persona?: { name?: string; role?: string } } | null;
  }>;
  forecast: {
    predictedBalance: number;
    riskLevel: string;
  };
  notifications: Array<{
    title: string;
    message: string;
  }>;
};

export type AssistantActionKind =
  | "create_task"
  | "create_goal"
  | "create_reminder"
  | "open_module";

export type AssistantModule =
  | "dashboard"
  | "tasks"
  | "finances"
  | "goals"
  | "imports"
  | "general";

export type AssistantActionImportance = "low" | "medium" | "high";

export type AssistantAction = {
  id: string;
  kind: AssistantActionKind;
  title: string;
  description: string;
  targetModule: AssistantModule;
  importance: AssistantActionImportance;
  route: string | null;
  payload: Record<string, unknown> | null;
};

export type AssistantProactiveSignalSeverity = "info" | "warning" | "critical";

export type AssistantProactiveSignal = {
  id: string;
  title: string;
  message: string;
  severity: AssistantProactiveSignalSeverity;
  targetModule: AssistantModule;
  suggestedPrompt: string | null;
  suggestedActionLabel: string | null;
};

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

export type SelahResponse = {
  answer?: unknown;
  highlights?: unknown;
  suggestedActions?: unknown;
  focusArea?: unknown;
  confidence?: unknown;
  disclaimer?: unknown;
  provider?: unknown;
  model?: unknown;
  generatedAt?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
  confidenceReason?: unknown;
  followUpPrompt?: unknown;
};

export type AssistantPrivacySettings = {
  privacyNoticeAcceptedAt: Date | null;
  aiAssistantEnabled: boolean;
  aiAssistantConsentAt: Date | null;
};

export type SelahAttemptReason =
  | "privacy_notice_missing"
  | "ai_consent_missing"
  | "integration_disabled"
  | "selah_unavailable"
  | null;

export type AssistantFallbackOutcome =
  | { status: "answered"; text: string }
  | { status: "blocked_by_plan" }
  | { status: "no_consent" }
  | { status: "unavailable" };
