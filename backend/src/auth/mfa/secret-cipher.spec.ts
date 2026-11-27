import { createHash } from "crypto";
import { decryptSecretPayload, encryptSecretPayload, parseSecretPayload } from "./secret-cipher";

const key = createHash("sha256").update("k").digest();

describe("secret-cipher", () => {
  it("faz roundtrip e gera formato v1:iv(12):tag(16):dados", () => {
    const payload = encryptSecretPayload("JBSWY3DP", key);
    const [version, iv, tag, data] = payload.split(":");

    expect(version).toBe("v1");
    expect(Buffer.from(iv, "base64")).toHaveLength(12);
    expect(Buffer.from(tag, "base64")).toHaveLength(16);
    expect(data).toBeTruthy();
    expect(decryptSecretPayload(parseSecretPayload(payload), key)).toBe("JBSWY3DP");
  });

  it("usa iv novo a cada cifra", () => {
    expect(encryptSecretPayload("x", key)).not.toBe(encryptSecretPayload("x", key));
  });

  it("detecta adulteracao de dados, tag e chave errada", () => {
    const [v, iv, tag, data] = encryptSecretPayload("JBSWY3DP", key).split(":");
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 1;
      return buf.toString("base64");
    };
    const open = (p: string, k = key) => () => decryptSecretPayload(parseSecretPayload(p), k);

    expect(open([v, iv, tag, flip(data)].join(":"))).toThrow();
    expect(open([v, iv, flip(tag), data].join(":"))).toThrow();
    expect(open([v, flip(iv), tag, data].join(":"))).toThrow();
    expect(open([v, iv, tag, data].join(":"), createHash("sha256").update("z").digest())).toThrow();
  });

  it.each(["v2:a:b:c", "v1::b:c", "v1:a::c", "v1:a:b:", "v1:a:b", "", "lixo"])(
    "rejeita payload %j com a mensagem exata",
    (payload) => {
      expect(() => parseSecretPayload(payload)).toThrow(new Error("Payload MFA invalido."));
    },
  );
});
