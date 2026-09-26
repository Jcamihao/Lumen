import { isAvatarDataUrl } from "./avatar-data-url.validator";

describe("isAvatarDataUrl", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString("base64");

  it("aceita vazio (limpar a foto) e imagens de verdade", () => {
    expect(isAvatarDataUrl("")).toBe(true);
    expect(isAvatarDataUrl(`data:image/png;base64,${png}`)).toBe(true);
    expect(isAvatarDataUrl(`data:image/jpeg;base64,${jpeg}`)).toBe(true);
    expect(isAvatarDataUrl(`data:image/jpg;base64,${jpeg}`)).toBe(true);
  });

  it("recusa URLs e esquemas que nao sao imagem", () => {
    expect(isAvatarDataUrl("https://evil.example/pixel.png")).toBe(false);
    expect(isAvatarDataUrl("javascript:alert(1)")).toBe(false);
    expect(isAvatarDataUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  });

  it("recusa quando o conteudo nao e a imagem declarada", () => {
    const html = Buffer.from("<script>alert(1)</script>").toString("base64");
    expect(isAvatarDataUrl(`data:image/png;base64,${html}`)).toBe(false);
    expect(isAvatarDataUrl(`data:image/png;base64,${jpeg}`)).toBe(false);
  });

  it("recusa base64 com lixo e valores que nao sao texto", () => {
    expect(isAvatarDataUrl("data:image/png;base64,@@@@")).toBe(false);
    expect(isAvatarDataUrl(123)).toBe(false);
    expect(isAvatarDataUrl(null)).toBe(false);
  });
});
