import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type MfaUserState = {
  mfaEnabledAt?: Date | null;
  mfaTotpSecretEncrypted?: string | null;
};

export function isMfaEnabled(user: MfaUserState): boolean {
  return Boolean(user.mfaEnabledAt && user.mfaTotpSecretEncrypted);
}

export function assertMfaIsConfigured(user: MfaUserState): void {
  if (!isMfaEnabled(user)) {
    throw new BadRequestException("O MFA ainda nao esta ativo para esta conta.");
  }
}

/** Liga/desliga o MFA no ambiente (configuracao auth.mfaEnabled). */
@Injectable()
export class MfaGate {
  constructor(private readonly config: ConfigService) {}

  isFeatureEnabled(): boolean {
    return this.config.get<boolean>("auth.mfaEnabled") ?? false;
  }

  assertFeatureEnabled(): void {
    if (this.isFeatureEnabled()) return;
    throw new ServiceUnavailableException("O MFA esta temporariamente indisponivel neste ambiente.");
  }
}
