import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "crypto";
import { normalizeCode } from "./mfa/normalize-code";
import {
  decryptSecretPayload,
  encryptSecretPayload,
  parseSecretPayload,
} from "./mfa/secret-cipher";
import { createRecoveryCodes } from "./mfa/recovery/recovery-codes";
import {
  countUnusedRecoveryCodes,
  MfaRecoveryCodeRecord,
  parseStoredRecoveryCodes,
  useRecoveryCode,
} from "./mfa/recovery/recovery-code-records";
import { base32Encode } from "./mfa/totp/base32";
import { buildOtpAuthUrl } from "./mfa/totp/otpauth-url";
import { findTotpStep, TOTP_PERIOD_MS, totpCodeAt } from "./mfa/totp/totp-code";

export type { MfaRecoveryCodeRecord } from "./mfa/recovery/recovery-code-records";

@Injectable()
export class MfaService {
  constructor(private readonly configService: ConfigService) {}

  generateTotpSecret() {
    return base32Encode(randomBytes(20));
  }

  buildOtpAuthUrl(email: string, secret: string) {
    const issuer = this.configService.get<string>("auth.mfaIssuer") ?? "LUMEN";
    return buildOtpAuthUrl(issuer, email, secret);
  }

  encryptSecret(secret: string) {
    return encryptSecretPayload(secret, this.getEncryptionKey());
  }

  decryptSecret(payload: string) {
    return decryptSecretPayload(parseSecretPayload(payload), this.getEncryptionKey());
  }

  verifyTotpCode(secret: string, code: string) {
    return this.matchTotpStep(secret, code) !== null;
  }

  /** Passo (janela de 30s) em que o codigo bate, ou null. Serve pra recusar reuso. */
  matchTotpStep(secret: string, code: string): number | null {
    const currentCounter = Math.floor(Date.now() / TOTP_PERIOD_MS);
    return findTotpStep(secret, normalizeCode(code), currentCounter);
  }

  generateRecoveryCodes() {
    return createRecoveryCodes();
  }

  consumeRecoveryCode(code: string, records: MfaRecoveryCodeRecord[]) {
    return useRecoveryCode(code, records);
  }

  countRemainingRecoveryCodes(records: MfaRecoveryCodeRecord[] | null | undefined) {
    return countUnusedRecoveryCodes(records);
  }

  parseRecoveryCodeRecords(value: unknown): MfaRecoveryCodeRecord[] {
    return parseStoredRecoveryCodes(value);
  }

  private generateTotpCode(secret: string, counter: number) {
    return totpCodeAt(secret, counter);
  }

  private getEncryptionKey() {
    const secret = this.configService.getOrThrow<string>("auth.mfaEncryptionSecret");
    return createHash("sha256").update(secret).digest();
  }
}
