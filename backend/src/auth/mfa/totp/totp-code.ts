import { createHmac, timingSafeEqual } from "crypto";
import { base32Decode } from "./base32";

export const TOTP_PERIOD_MS = 30_000;
export const TOTP_DIGITS = 6;

const CODE_FORMAT = new RegExp(`^\\d{${TOTP_DIGITS}}$`);
const STEP_WINDOW = [-1, 0, 1];

export function totpCodeAt(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binaryCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Passo em que o codigo (ja normalizado) bate dentro da janela de +-1 passo, ou null. */
export function findTotpStep(secret: string, code: string, currentCounter: number): number | null {
  if (!CODE_FORMAT.test(code)) {
    return null;
  }

  for (const offset of STEP_WINDOW) {
    const step = currentCounter + offset;
    const expectedCode = totpCodeAt(secret, step);

    if (timingSafeEqual(Buffer.from(expectedCode), Buffer.from(code))) {
      return step;
    }
  }

  return null;
}
