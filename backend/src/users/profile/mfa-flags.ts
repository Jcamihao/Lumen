export type MfaAccountFields = {
  mfaEnabledAt: Date | null;
  mfaLastVerifiedAt: Date | null;
  mfaPendingTotpSecretEncrypted: string | null;
  mfaRecoveryCodes: unknown;
};

export function buildMfaFlags(account: MfaAccountFields, featureEnabled: boolean) {
  return {
    mfaEnabledAt: featureEnabled ? account.mfaEnabledAt : null,
    mfaLastVerifiedAt: featureEnabled ? account.mfaLastVerifiedAt : null,
    mfaEnabled: featureEnabled && Boolean(account.mfaEnabledAt),
    mfaSetupPending: featureEnabled && Boolean(account.mfaPendingTotpSecretEncrypted),
    mfaRecoveryCodesRemaining: featureEnabled
      ? countRemainingRecoveryCodes(account.mfaRecoveryCodes)
      : 0,
  };
}

function countRemainingRecoveryCodes(value: unknown) {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      (!("usedAt" in item) || (item as { usedAt?: string | null }).usedAt === null),
  ).length;
}
