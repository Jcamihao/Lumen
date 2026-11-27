import { ConfigService } from "@nestjs/config";
import { MfaService } from "./mfa.service";

function build(values: Record<string, string> = { "auth.mfaEncryptionSecret": "s" }) {
  const getOrThrow = jest.fn((k: string) => values[k]);
  const get = jest.fn((k: string) => values[k]);
  const service = new MfaService({ get, getOrThrow } as unknown as ConfigService);
  return { service, getOrThrow };
}

describe("MfaService (fachada)", () => {
  it("rejeita payload invalido antes de pedir a chave", () => {
    const { service, getOrThrow } = build();

    expect(() => service.decryptSecret("v9:a:b:c")).toThrow("Payload MFA invalido.");
    expect(getOrThrow).not.toHaveBeenCalled();
  });

  it("cifra e decifra com chave SHA-256 do segredo", () => {
    const { service } = build();
    expect(service.decryptSecret(service.encryptSecret("ABC"))).toBe("ABC");
  });

  it("gera segredo base32 de 20 bytes (32 caracteres)", () => {
    expect(build().service.generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("usa emissor LUMEN por padrao", () => {
    const url = build().service.buildOtpAuthUrl("a@b.c", "SEC");
    expect(url).toContain("issuer=LUMEN&");
  });

  it("normaliza o codigo TOTP (espacos) antes de comparar", () => {
    const { service } = build();
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const step = Math.floor(Date.now() / 30_000);
    const code = (service as any).generateTotpCode(secret, step) as string;

    expect(service.matchTotpStep(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(step);
  });
});
