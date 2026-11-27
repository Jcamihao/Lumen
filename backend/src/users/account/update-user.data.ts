import { Prisma } from "@prisma/client";
import { UpdateUserDto } from "../dto/update-user.dto";
import {
  buildAiConsentUpdate,
  buildPrivacyNoticeUpdate,
  CurrentConsent,
} from "./consent-update.data";

function buildIdentityUpdate(dto: UpdateUserDto) {
  return {
    name: dto.name,
    avatarUrl: dto.avatarUrl,
    phone: dto.phone,
    birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
    occupation: dto.occupation,
    primaryGoal: dto.primaryGoal,
    preferredCurrency: dto.preferredCurrency,
    monthlyIncome:
      dto.monthlyIncome !== undefined ? new Prisma.Decimal(dto.monthlyIncome) : undefined,
    timezone: dto.timezone,
  };
}

function buildEmailPreferencesUpdate(dto: UpdateUserDto) {
  return {
    emailWeeklyDigest: dto.emailWeeklyDigest,
    emailReminders: dto.emailReminders,
    emailInsightAlerts: dto.emailInsightAlerts,
    emailBillReminders: dto.emailBillReminders,
  };
}

export function buildUserUpdateData(dto: UpdateUserDto, current: CurrentConsent, now: Date) {
  return {
    ...buildIdentityUpdate(dto),
    ...buildEmailPreferencesUpdate(dto),
    ...buildPrivacyNoticeUpdate(dto, current, now),
    ...buildAiConsentUpdate(dto, current, now),
  };
}
