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
