import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export type MfaRecoveryCodeRecord = {
  hash: string;
  usedAt: string | null;
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_MS = 30_000;
const TOTP_DIGITS = 6;
const RECOVERY_CODES_COUNT = 8;

@Injectable()
export class MfaService {
  constructor(private readonly configService: ConfigService) {}

  generateTotpSecret() {
    return this.base32Encode(randomBytes(20));
  }

  buildOtpAuthUrl(email: string, secret: string) {
    const issuer = this.configService.get<string>("auth.mfaIssuer") ?? "LUMEN";
    const label = `${issuer}:${email}`;

    return (
      `otpauth://totp/${encodeURIComponent(label)}` +
      `?secret=${encodeURIComponent(secret)}` +
      `&issuer=${encodeURIComponent(issuer)}` +
      `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=30`
    );
  }

  encryptSecret(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      "v1",
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":");
  }

  decryptSecret(payload: string) {
    const [version, ivPart, authTagPart, encryptedPart] = payload.split(":");

    if (
      version !== "v1" ||
      !ivPart ||
      !authTagPart ||
      !encryptedPart
    ) {
      throw new Error("Payload MFA invalido.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.getEncryptionKey(),
      Buffer.from(ivPart, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  verifyTotpCode(secret: string, code: string) {
    const normalizedCode = this.normalizeCode(code);
    const currentCounter = Math.floor(Date.now() / TOTP_PERIOD_MS);

    if (!/^\d{6}$/.test(normalizedCode)) {
      return false;
    }

    for (let offset = -1; offset <= 1; offset += 1) {
      const expectedCode = this.generateTotpCode(secret, currentCounter + offset);

      if (
        timingSafeEqual(
          Buffer.from(expectedCode),
          Buffer.from(normalizedCode),
        )
      ) {
        return true;
      }
    }

    return false;
  }

  async generateRecoveryCodes() {
    const plainCodes = Array.from({ length: RECOVERY_CODES_COUNT }, () =>
      this.formatRecoveryCode(randomBytes(5).toString("hex").slice(0, 10)),
    );
    const hashedCodes = await Promise.all(
      plainCodes.map(async (code) => ({
        hash: await bcrypt.hash(this.normalizeCode(code), 10),
        usedAt: null,
      })),
    );

    return {
      plainCodes,
      hashedCodes,
    };
  }

  async consumeRecoveryCode(
    code: string,
    records: MfaRecoveryCodeRecord[],
  ): Promise<{ matched: boolean; updatedRecords: MfaRecoveryCodeRecord[] }> {
    const normalizedCode = this.normalizeCode(code);
    const updatedRecords = [...records];

    for (let index = 0; index < updatedRecords.length; index += 1) {
      const record = updatedRecords[index];

      if (record.usedAt) {
        continue;
      }

      const matches = await bcrypt.compare(normalizedCode, record.hash);

      if (!matches) {
        continue;
      }

      updatedRecords[index] = {
        ...record,
        usedAt: new Date().toISOString(),
      };

      return {
        matched: true,
        updatedRecords,
      };
    }

    return {
      matched: false,
      updatedRecords,
    };
  }

  countRemainingRecoveryCodes(records: MfaRecoveryCodeRecord[] | null | undefined) {
    return (records ?? []).filter((record) => !record.usedAt).length;
  }

  parseRecoveryCodeRecords(value: unknown): MfaRecoveryCodeRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        (item): item is MfaRecoveryCodeRecord =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as MfaRecoveryCodeRecord).hash === "string",
          ),
      )
      .map((item) => ({
        hash: item.hash,
        usedAt:
          typeof item.usedAt === "string" || item.usedAt === null
            ? item.usedAt
            : null,
      }));
  }

  private getEncryptionKey() {
    const secret = this.configService.getOrThrow<string>(
      "auth.mfaEncryptionSecret",
    );
    return createHash("sha256").update(secret).digest();
  }

  private base32Encode(buffer: Buffer) {
    let bits = 0;
    let value = 0;
    let output = "";

    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
  }

  private base32Decode(secret: string) {
    const normalizedSecret = secret.replace(/=+$/g, "").toUpperCase();
    let bits = 0;
    let value = 0;
    const output: number[] = [];

    for (const char of normalizedSecret) {
      const index = BASE32_ALPHABET.indexOf(char);

      if (index < 0) {
        continue;
      }

      value = (value << 5) | index;
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(output);
  }

  private generateTotpCode(secret: string, counter: number) {
    const key = this.base32Decode(secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac("sha1", key).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binaryCode =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    return String(binaryCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
  }

  private formatRecoveryCode(value: string) {
    const normalizedValue = value.toUpperCase();
    return `${normalizedValue.slice(0, 5)}-${normalizedValue.slice(5, 10)}`;
  }

  private normalizeCode(code: string) {
    return code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }
}
