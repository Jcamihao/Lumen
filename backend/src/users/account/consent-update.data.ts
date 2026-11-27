import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../privacy.constants";
import { UpdateUserDto } from "../dto/update-user.dto";

export type CurrentConsent = {
  privacyNoticeAcceptedAt: Date | null;
  aiAssistantConsentAt: Date | null;
};

export function buildPrivacyNoticeUpdate(dto: UpdateUserDto, current: CurrentConsent, now: Date) {
  if (!dto.privacyNoticeAccepted) {
    return {};
  }
  return {
    privacyNoticeAcceptedAt: current.privacyNoticeAcceptedAt ?? now,
    privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
  };
}

export function buildAiConsentUpdate(dto: UpdateUserDto, current: CurrentConsent, now: Date) {
  if (dto.aiAssistantEnabled === undefined) {
    return {};
  }
  if (!dto.aiAssistantEnabled) {
    return { aiAssistantEnabled: false, aiAssistantConsentAt: null, aiAssistantConsentVersion: null };
  }
  return {
    aiAssistantEnabled: true,
    aiAssistantConsentAt: current.aiAssistantConsentAt ?? now,
    aiAssistantConsentVersion: CURRENT_AI_CONSENT_VERSION,
  };
}
