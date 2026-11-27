import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../privacy.constants";
import { AccountPrivacyFields, buildExternalProcessing } from "./external-processing";

type PrivacyAccountFields = AccountPrivacyFields & {
  privacyNoticeVersion: string | null;
  aiAssistantConsentVersion: string | null;
};

export function buildPrivacySection(account: PrivacyAccountFields) {
  return {
    privacyNoticeVersionCurrent: CURRENT_PRIVACY_NOTICE_VERSION,
    aiConsentVersionCurrent: CURRENT_AI_CONSENT_VERSION,
    privacyNoticeAcceptedAt: account.privacyNoticeAcceptedAt,
    privacyNoticeVersion: account.privacyNoticeVersion,
    aiAssistantEnabled: account.aiAssistantEnabled,
    aiAssistantConsentAt: account.aiAssistantConsentAt,
    aiAssistantConsentVersion: account.aiAssistantConsentVersion,
    externalProcessing: buildExternalProcessing(account),
  };
}
