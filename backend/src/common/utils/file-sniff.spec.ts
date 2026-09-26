import { looksLikeText, sniffMime } from "./file-sniff";

describe("sniffMime", () => {
  const b = (...bytes: number[]) => Buffer.from(bytes);

  it.each([
    ["image/jpeg", b(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)],
    ["image/png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)],
    ["image/gif", Buffer.from("GIF89a....")],
    ["application/pdf", Buffer.from("%PDF-1.7\n...")],
    ["image/webp", Buffer.concat([Buffer.from("RIFF"), b(1, 2, 3, 4), Buffer.from("WEBPVP8 ")])],
    ["image/heic", Buffer.concat([b(0, 0, 0, 0x18), Buffer.from("ftypheic")])],
  ])("reconhece %s pelos bytes", (expected, buffer) => {
    expect(sniffMime(buffer as Buffer)).toBe(expected);
  });

  it("nao confia no nome: HTML, texto e executavel viram null", () => {
    expect(sniffMime(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffMime(Buffer.from("data;valor\n1;2"))).toBeNull();
    expect(sniffMime(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });

  it("looksLikeText: texto passa, binario com NUL nao", () => {
    expect(looksLikeText(Buffer.from("data,valor\n2026-09-01,10"))).toBe(true);
    expect(looksLikeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false);
  });
});
