import { Prisma } from "@prisma/client";
import { toCategoryResponse } from "../../finance-categories/finance-categories.service";
import { omitKeys } from "../shared/omit-keys";
import { buildMfaFlags } from "./mfa-flags";

type SanitizableUser = Prisma.UserGetPayload<{ include: { financeCategories: true } }>;

const HIDDEN_FIELDS = [
  "passwordHash",
  "mfaTotpSecretEncrypted",
  "mfaPendingTotpSecretEncrypted",
  "mfaRecoveryCodes",
  "mfaLastTotpStep",
] as const;

export function sanitizePublicUser(user: SanitizableUser, mfaFeatureEnabled: boolean) {
  const safeUser = omitKeys(user, HIDDEN_FIELDS);
  return {
    ...safeUser,
    monthlyIncome: Number(safeUser.monthlyIncome ?? 0),
    financeCategories: safeUser.financeCategories.map(toCategoryResponse),
    ...buildMfaFlags(user, mfaFeatureEnabled),
  };
}
