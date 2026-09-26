import { BadRequestException } from "@nestjs/common";
import { ImportsService } from "./imports.service";

describe("ImportsService — validacao de arquivo enviado", () => {
  // Estas validacoes rodam ANTES de qualquer acesso ao banco.
  const service = new ImportsService({} as any, {} as any, {} as any);
  const file = (buffer: Buffer, over: Record<string, unknown> = {}) =>
    ({ buffer, size: buffer.length, originalname: "arquivo", mimetype: "text/csv", ...over }) as any;
  const preview = (f: any) => service.previewTransactionsImport("user-1", f);
  const receipt = (f: any) => (service as any).ensureReceiptFile(f);

  const csv = (rows: number) => Buffer.from(["data,descricao,valor", ...Array.from({ length: rows }, (_, i) => `2026-09-01,item ${i},10`)].join("\n"));

  describe("CSV", () => {
    it("recusa arquivo acima de 5 MB", async () => {
      await expect(preview(file(Buffer.alloc(5 * 1024 * 1024 + 1, "a")))).rejects.toThrow("no maximo 5 MB");
    });

    it("recusa binario disfarcado de CSV (byte NUL)", async () => {
      await expect(preview(file(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])))).rejects.toThrow("nao parece um CSV");
    });

    it("recusa imagem/PDF enviado como CSV", async () => {
      await expect(preview(file(Buffer.from("%PDF-1.7 texto sem nul")))).rejects.toThrow("nao parece um CSV");
    });

    it("recusa mais de 5000 linhas (a leitura para no teto)", async () => {
      await expect(preview(file(csv(5001)))).rejects.toThrow("no maximo 5000 linhas");
    });

    it("CSV malformado vira 400 com mensagem, nao 500", async () => {
      await expect(preview(file(Buffer.from('a,b\n"aberto,1\n2,3')))).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("nota fiscal", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

    it("aceita PNG real, mesmo com mimetype mentiroso do cliente", () => {
      expect(() => receipt(file(png, { mimetype: "application/octet-stream" }))).not.toThrow();
    });

    it("recusa HTML/texto que se declara image/png", () => {
      expect(() => receipt(file(Buffer.from("<script>alert(1)</script>"), { mimetype: "image/png" }))).toThrow("Formato invalido");
    });

    it("imagem acima de 8 MB e PDF acima de 10 MB sao recusados", () => {
      const bigImage = Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]);
      const bigPdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(10 * 1024 * 1024)]);
      expect(() => receipt(file(bigImage))).toThrow("no maximo 8 MB");
      expect(() => receipt(file(bigPdf))).toThrow("no maximo 10 MB");
    });

    it("sem arquivo: pede o envio", () => {
      expect(() => receipt(undefined)).toThrow("Envie uma imagem ou PDF");
    });
  });
});
