import * as bcrypt from "bcryptjs";
import { normalizeCode } from "../normalize-code";

export type MfaRecoveryCodeRecord = {
  hash: string;
  usedAt: string | null;
};

export type RecoveryCodeUseResult = {
  matched: boolean;
  updatedRecords: MfaRecoveryCodeRecord[];
};

export async function useRecoveryCode(
  code: string,
  records: MfaRecoveryCodeRecord[],
): Promise<RecoveryCodeUseResult> {
  const index = await findUnusedMatchIndex(normalizeCode(code), records);
  const updatedRecords = [...records];

  if (index < 0) {
    return { matched: false, updatedRecords };
  }

  updatedRecords[index] = { ...records[index], usedAt: new Date().toISOString() };
  return { matched: true, updatedRecords };
}

export function countUnusedRecoveryCodes(records: MfaRecoveryCodeRecord[] | null | undefined) {
  return (records ?? []).filter((record) => !record.usedAt).length;
}

export function parseStoredRecoveryCodes(value: unknown): MfaRecoveryCodeRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecoveryCodeRecord).map(toRecoveryCodeRecord);
}

async function findUnusedMatchIndex(code: string, records: MfaRecoveryCodeRecord[]) {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (!record.usedAt && (await bcrypt.compare(code, record.hash))) {
      return index;
    }
  }

  return -1;
}

function isRecoveryCodeRecord(item: unknown): item is MfaRecoveryCodeRecord {
  return Boolean(
    item &&
      typeof item === "object" &&
      typeof (item as MfaRecoveryCodeRecord).hash === "string",
  );
}

function toRecoveryCodeRecord(item: MfaRecoveryCodeRecord): MfaRecoveryCodeRecord {
  return {
    hash: item.hash,
    usedAt:
      typeof item.usedAt === "string" || item.usedAt === null ? item.usedAt : null,
  };
}
