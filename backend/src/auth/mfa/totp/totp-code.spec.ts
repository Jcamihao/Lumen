import * as crypto from "crypto";
import { findTotpStep, totpCodeAt } from "./totp-code";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp-code", () => {
  it("bate o vetor RFC 6238 SHA1 T=59 (8 digitos -> 6 digitos finais)", () => {
    expect(totpCodeAt(RFC_SECRET, 1)).toBe("287082");
  });

  it("aceita passos -1, 0 e +1 e rejeita +-2", () => {
    const at = (step: number) => totpCodeAt(RFC_SECRET, step);

    expect(findTotpStep(RFC_SECRET, at(99), 100)).toBe(99);
    expect(findTotpStep(RFC_SECRET, at(100), 100)).toBe(100);
    expect(findTotpStep(RFC_SECRET, at(101), 100)).toBe(101);
    expect(findTotpStep(RFC_SECRET, at(98), 100)).toBeNull();
    expect(findTotpStep(RFC_SECRET, at(102), 100)).toBeNull();
  });

  it.each(["12345", "1234567", "12345a", "", "123 456"])(
    "recusa %j sem lancar excecao",
    (code) => {
      expect(findTotpStep(RFC_SECRET, code, 100)).toBeNull();
    },
  );

  it("compara em tempo constante", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");

    findTotpStep(RFC_SECRET, "000000", 100);

    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
