import * as bcrypt from "bcryptjs";
import { createRecoveryCodes } from "./recovery-codes";

describe("createRecoveryCodes", () => {
  it("gera 8 codigos XXXXX-XXXXX com hash bcrypt custo 10 do codigo normalizado", async () => {
    const { plainCodes, hashedCodes } = await createRecoveryCodes();

    expect(plainCodes).toHaveLength(8);
    expect(hashedCodes).toHaveLength(8);
    plainCodes.forEach((code, i) => {
      expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
      expect(hashedCodes[i].usedAt).toBeNull();
      expect(hashedCodes[i].hash).toMatch(/^\$2[aby]\$10\$/);
      expect(bcrypt.compareSync(code.replace("-", ""), hashedCodes[i].hash)).toBe(true);
    });
  });
});
