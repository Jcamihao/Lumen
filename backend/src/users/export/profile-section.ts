import { buildMfaFlags } from "../profile/mfa-flags";
import { ExportableUser } from "./export-user.query";
import { toAccountFields } from "./export-fields";

export function buildProfileSection(user: ExportableUser, mfaFeatureEnabled: boolean) {
  const account = toAccountFields(user);
  return {
    ...account,
    monthlyIncome: Number(account.monthlyIncome ?? 0),
    ...buildMfaFlags(user, mfaFeatureEnabled),
  };
}
