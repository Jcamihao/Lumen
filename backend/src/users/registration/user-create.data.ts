import { Prisma, UserRole } from "@prisma/client";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../privacy.constants";
import { CreateUserInput } from "./create-user.input";

function privacyNoticeFields(accepted: boolean, now: Date) {
  return {
    privacyNoticeAcceptedAt: accepted ? now : null,
    privacyNoticeVersion: accepted ? CURRENT_PRIVACY_NOTICE_VERSION : null,
  };
}

function aiConsentFields(enabled: boolean, now: Date) {
  return {
    aiAssistantEnabled: enabled,
    aiAssistantConsentAt: enabled ? now : null,
    aiAssistantConsentVersion: enabled ? CURRENT_AI_CONSENT_VERSION : null,
  };
}

function buildAccountData(input: CreateUserInput) {
  return {
    name: input.name,
    email: input.email,
    passwordHash: input.passwordHash,
    avatarUrl: input.avatarUrl,
    phone: input.phone,
    birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
    occupation: input.occupation,
    primaryGoal: input.primaryGoal,
    role: input.role ?? UserRole.USER,
    preferredCurrency: input.preferredCurrency ?? "BRL",
    monthlyIncome:
      input.monthlyIncome !== undefined
        ? new Prisma.Decimal(input.monthlyIncome)
        : new Prisma.Decimal(0),
    timezone: input.timezone ?? "America/Sao_Paulo",
  };
}

export function buildUserCreateData(input: CreateUserInput, now: Date) {
  const privacyAccepted = Boolean(input.privacyNoticeAccepted);
  const aiEnabled = Boolean(input.aiAssistantEnabled && privacyAccepted);
  return {
    ...buildAccountData(input),
    ...privacyNoticeFields(privacyAccepted, now),
    ...aiConsentFields(aiEnabled, now),
  };
}
