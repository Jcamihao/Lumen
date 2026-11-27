import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const PAYLOAD_VERSION = "v1";
const IV_BYTES = 12;

export type SecretPayloadParts = {
  iv: string;
  authTag: string;
  encrypted: string;
};

export function encryptSecretPayload(secret: string, key: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  return [
    PAYLOAD_VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function parseSecretPayload(payload: string): SecretPayloadParts {
  const [version, iv, authTag, encrypted] = payload.split(":");

  if (version !== PAYLOAD_VERSION || !iv || !authTag || !encrypted) {
    throw new Error("Payload MFA invalido.");
  }

  return { iv, authTag, encrypted };
}

export function decryptSecretPayload(parts: SecretPayloadParts, key: Buffer) {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parts.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parts.encrypted, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
