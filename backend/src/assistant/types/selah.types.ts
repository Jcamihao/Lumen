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
