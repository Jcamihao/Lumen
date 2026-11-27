import * as bcrypt from "bcryptjs";
import {
  countUnusedRecoveryCodes,
  parseStoredRecoveryCodes,
  useRecoveryCode,
} from "./recovery-code-records";

const hash = bcrypt.hashSync("ABCDE12345", 4);

describe("recovery-code-records", () => {
  it("marca so o primeiro igual, pula usados, nao muta a entrada e grava usedAt ISO", async () => {
    const used = { hash, usedAt: "2020-01-01T00:00:00.000Z" };
    const records = [used, { hash, usedAt: null }, { hash, usedAt: null }];
    const snapshot = JSON.parse(JSON.stringify(records));

    const result = await useRecoveryCode("abcde-12345", records);

    expect(result.matched).toBe(true);
    expect(result.updatedRecords[0]).toEqual(used);
    expect(result.updatedRecords[1].usedAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(new Date(result.updatedRecords[1].usedAt as string).toISOString()).toBe(
      result.updatedRecords[1].usedAt,
    );
    expect(result.updatedRecords[2].usedAt).toBeNull();
    expect(result.updatedRecords).not.toBe(records);
    expect(records).toEqual(snapshot);
  });

  it("sem match devolve copia intacta", async () => {
    const records = [{ hash, usedAt: null }];
    const result = await useRecoveryCode("ZZZZZ-ZZZZZ", records);

    expect(result.matched).toBe(false);
    expect(result.updatedRecords).toEqual(records);
    expect(result.updatedRecords).not.toBe(records);
  });

  it("conta so os nao usados e aceita null/undefined", () => {
    expect(countUnusedRecoveryCodes([{ hash, usedAt: "x" }, { hash, usedAt: null }])).toBe(1);
    expect(countUnusedRecoveryCodes(null)).toBe(0);
    expect(countUnusedRecoveryCodes(undefined)).toBe(0);
  });

  it("parse descarta invalidos e normaliza usedAt", () => {
    expect(parseStoredRecoveryCodes("x")).toEqual([]);
    expect(parseStoredRecoveryCodes(null)).toEqual([]);
    expect(
      parseStoredRecoveryCodes([
        null, 1, {}, { hash: 5 },
        { hash: "a" },
        { hash: "b", usedAt: "t", extra: 1 },
        { hash: "c", usedAt: 7 },
        { hash: "d", usedAt: null },
      ]),
    ).toEqual([
      { hash: "a", usedAt: null },
      { hash: "b", usedAt: "t" },
      { hash: "c", usedAt: null },
      { hash: "d", usedAt: null },
    ]);
  });
});
