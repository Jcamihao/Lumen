import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { normalizeCode } from "../normalize-code";

const RECOVERY_CODES_COUNT = 8;
const BCRYPT_COST = 10;

export async function createRecoveryCodes() {
  const plainCodes = Array.from({ length: RECOVERY_CODES_COUNT }, () =>
    formatRecoveryCode(randomBytes(5).toString("hex").slice(0, 10)),
  );
  const hashedCodes = await Promise.all(
    plainCodes.map(async (code) => ({
      hash: await bcrypt.hash(normalizeCode(code), BCRYPT_COST),
      usedAt: null,
    })),
  );

  return { plainCodes, hashedCodes };
}

function formatRecoveryCode(value: string) {
  const normalizedValue = value.toUpperCase();
  return `${normalizedValue.slice(0, 5)}-${normalizedValue.slice(5, 10)}`;
}
