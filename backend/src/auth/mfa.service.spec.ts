import { MfaService } from "./mfa.service";

describe("MfaService", () => {
  const buildService = () =>
    new MfaService({
      get: jest.fn(),
      getOrThrow: jest.fn((key: string) => {
        if (key === "auth.mfaEncryptionSecret") {
          return "test-mfa-encryption-secret";
        }
        throw new Error(`unexpected config key ${key}`);
      }),
    } as any);

  describe("verifyTotpCode", () => {
    it("accepts a code generated for the current time window", () => {
      const service = buildService();
      const secret = service.generateTotpSecret();
      const currentCounter = Math.floor(Date.now() / 30_000);
      const code = (service as any).generateTotpCode(secret, currentCounter);

      expect(service.verifyTotpCode(secret, code)).toBe(true);
    });

    it("accepts a code from an adjacent time window (clock drift tolerance)", () => {
      const service = buildService();
      const secret = service.generateTotpSecret();
      const currentCounter = Math.floor(Date.now() / 30_000);
      const previousWindowCode = (service as any).generateTotpCode(
        secret,
        currentCounter - 1,
      );

      expect(service.verifyTotpCode(secret, previousWindowCode)).toBe(true);
    });

    it("rejects a code that does not match any window in range", () => {
      const service = buildService();
      const secret = service.generateTotpSecret();

      expect(service.verifyTotpCode(secret, "000000")).toBe(false);
    });

    it("rejects a malformed code without crashing", () => {
      const service = buildService();
      const secret = service.generateTotpSecret();

      expect(service.verifyTotpCode(secret, "not-a-code")).toBe(false);
    });
  });

  describe("encryptSecret / decryptSecret", () => {
    it("round-trips a secret through encryption and decryption", () => {
      const service = buildService();
      const secret = service.generateTotpSecret();

      const encrypted = service.encryptSecret(secret);
      const decrypted = service.decryptSecret(encrypted);

      expect(decrypted).toBe(secret);
      expect(encrypted).not.toContain(secret);
    });

    it("fails to decrypt when the ciphertext has been tampered with", () => {
      const service = buildService();
      const secret = service.generateTotpSecret();
      const encrypted = service.encryptSecret(secret);
      const [version, iv, authTag, payload] = encrypted.split(":");
      const tamperedPayload = payload.slice(0, -4) + (payload.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
      const tampered = [version, iv, authTag, tamperedPayload].join(":");

      expect(() => service.decryptSecret(tampered)).toThrow();
    });
  });

  describe("recovery codes", () => {
    it("matches a valid code once and blocks reuse of the same code", async () => {
      const service = buildService();
      const { plainCodes, hashedCodes } = await service.generateRecoveryCodes();
      const codeToUse = plainCodes[0];

      const firstAttempt = await service.consumeRecoveryCode(
        codeToUse,
        hashedCodes,
      );
      expect(firstAttempt.matched).toBe(true);

      const secondAttempt = await service.consumeRecoveryCode(
        codeToUse,
        firstAttempt.updatedRecords,
      );
      expect(secondAttempt.matched).toBe(false);
    });

    it("rejects a code that was never generated", async () => {
      const service = buildService();
      const { hashedCodes } = await service.generateRecoveryCodes();

      const attempt = await service.consumeRecoveryCode(
        "ZZZZZ-ZZZZZ",
        hashedCodes,
      );
      expect(attempt.matched).toBe(false);
    });
  });
});
