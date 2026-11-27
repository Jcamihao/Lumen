import { UserRole } from "@prisma/client";

export type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl?: string;
  phone?: string;
  birthDate?: string;
  occupation?: string;
  primaryGoal?: string;
  preferredCurrency?: string;
  monthlyIncome?: number;
  monthClosingDay?: number;
  timezone?: string;
  role?: UserRole;
  privacyNoticeAccepted?: boolean;
  aiAssistantEnabled?: boolean;
};
