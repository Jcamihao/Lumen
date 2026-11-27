import { normalizeCode } from "./normalize-code";

describe("normalizeCode", () => {
  it("remove nao alfanumericos e poe em maiuscula", () => {
    expect(normalizeCode(" ab12c-d3_e4 \n")).toBe("AB12CD3E4");
    expect(normalizeCode("123 456")).toBe("123456");
  });
});
