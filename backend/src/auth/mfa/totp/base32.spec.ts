import { base32Decode, base32Encode } from "./base32";

describe("base32 (RFC 4648)", () => {
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("codifica %j como %j", (text, expected) => {
    expect(base32Encode(Buffer.from(text))).toBe(expected);
  });

  it("ignora caracteres fora do alfabeto ao decodificar", () => {
    expect(base32Decode("MZXW-6YTB OI!1").toString()).toBe("foobar");
  });

  it("decodifica de volta, ignorando padding e caixa", () => {
    expect(base32Decode("mzxw6ytboi===").toString()).toBe("foobar");
    expect(base32Decode("MZXW6YQ").toString()).toBe("foob");
  });
});
