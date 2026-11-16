import {
  RECEIPT_WARNINGS,
  decodeAccessKey,
  extractAccessKeyFromQr,
  fixNumericOcr,
  isValidAccessKeyDv,
  isValidCnpj,
  normalizeAccessKey,
  parseBrDate,
  parseBrMoney,
  parseBrQuantity,
  parseReceiptText,
  redactCpf,
  sanitizeQrUrl,
} from "./receipt-text.parser";

// Dados 100% sinteticos. CNPJ e chaves geradas aqui com DV correto.
const TODAY = new Date(Date.UTC(2026, 10, 16)); // 16/11/2026

function mod11Dv(body: string): number {
  let w = 2;
  let s = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    s += Number(body[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}

function cnpjDv(body: string, weights: number[]): number {
  const s = [...body].reduce((a, d, i) => a + Number(d) * weights[i], 0);
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}

function makeCnpj(base12: string): string {
  const d1 = cnpjDv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = cnpjDv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base12 + d1 + d2;
}

function makeKey(p: { aamm: string; cnpj: string; number: string; cnf: string; uf?: string; model?: string; series?: string }): string {
  const body = (p.uf ?? "35") + p.aamm + p.cnpj + (p.model ?? "65") + (p.series ?? "001") + p.number + "1" + p.cnf;
  return body + mod11Dv(body);
}

const CNPJ = "11222333000181"; // valido (conferido a mao)
const KEY = makeKey({ aamm: "2603", cnpj: CNPJ, number: "000001234", cnf: "12345678" });
const KEY_OTHER = makeKey({ aamm: "2603", cnpj: CNPJ, number: "000005678", cnf: "87654321" });
const flipLastDv = (k: string) => k.slice(0, 43) + ((Number(k[43]) + 1) % 10);
const fmtKey = (k: string) => k.match(/.{1,4}/g)!.join(" ");

const HEADER = ["SUPERMERCADO EXEMPLO LTDA", "CNPJ: 11.222.333/0001-81", "DANFE NFC-e", "Documento Auxiliar"];
const ITEMS = ["001 ARROZ TIPO 1 5KG 1 UN 24,90 24,90", "002 BANANA PRATA 0,350 KG x 17,50 6,13"]; // soma 31,03
const tailWith = (total: string | null, key: string | null = KEY, date = "09/03/2026 14:32:10"): string[] => [
  ...(total ? [total] : []),
  ...(key ? ["CHAVE DE ACESSO", fmtKey(key), "CONSUMIDOR NAO IDENTIFICADO"] : []),
  date,
];
const receipt = (o: { header?: string[]; items?: string[]; tail?: string[] } = {}) =>
  [...(o.header ?? HEADER), ...(o.items ?? ITEMS), ...(o.tail ?? tailWith("VALOR TOTAL R$ 31,03"))].join("\n");
const parse = (text: string, qrAccessKey?: string | null) => parseReceiptText(text, { today: TODAY, qrAccessKey });
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("parseBrMoney", () => {
  it.each([
    ["32,90", 32.9],
    ["1.234,56", 1234.56],
    ["R$ 32,90", 32.9],
    ["1.000.000,00", 1000000],
  ])("aceita %s", (raw, expected) => {
    expect(parseBrMoney(raw)).toBe(expected);
  });

  it.each(["0,00", "-5,00", "1.000.000,01", "32.90", "1,234.56", "abc", ""])("recusa %j", (raw) => {
    expect(parseBrMoney(raw)).toBeNull();
  });
});

describe("parseBrQuantity", () => {
  it.each([
    ["1", 1],
    ["0,350", 0.35],
    ["1,000", 1],
  ])("aceita %s", (raw, expected) => {
    expect(parseBrQuantity(raw)).toBe(expected);
  });

  it.each(["0", "1,2345", "-1"])("recusa %s", (raw) => {
    expect(parseBrQuantity(raw)).toBeNull();
  });
});

describe("parseBrDate", () => {
  it("aceita dd/mm/aaaa e dd/mm/aa (meia-noite UTC)", () => {
    const a = parseBrDate("05/03/2026", TODAY)!;
    expect(a.getTime()).toBe(Date.UTC(2026, 2, 5));
    expect(a.getUTCHours()).toBe(0);
    expect(parseBrDate("05/03/26", TODAY)!.getTime()).toBe(Date.UTC(2026, 2, 5));
  });

  it("recusa data inexistente, antes de 2000, amanha e 29/02 de ano comum", () => {
    expect(parseBrDate("31/02/2026", TODAY)).toBeNull();
    expect(parseBrDate("01/01/1999", TODAY)).toBeNull();
    expect(parseBrDate("17/11/2026", TODAY)).toBeNull();
    expect(parseBrDate("29/02/2025", TODAY)).toBeNull();
  });

  it("aceita hoje e 29/02 de ano bissexto", () => {
    expect(parseBrDate("16/11/2026", TODAY)!.getTime()).toBe(Date.UTC(2026, 10, 16));
    expect(parseBrDate("29/02/2024", TODAY)!.getTime()).toBe(Date.UTC(2024, 1, 29));
  });
});

describe("fixNumericOcr", () => {
  it("troca letras parecidas por digito", () => {
    expect(fixNumericOcr("O9")).toBe("09");
    expect(fixNumericOcr("l5BS")).toBe("1585");
  });
});

describe("chave de acesso", () => {
  it("aceita DV certo e recusa DV errado", () => {
    expect(isValidAccessKeyDv(KEY)).toBe(true);
    expect(isValidAccessKeyDv(flipLastDv(KEY))).toBe(false);
  });

  it("recusa 43 e 45 digitos", () => {
    expect(isValidAccessKeyDv(KEY.slice(1))).toBe(false);
    expect(isValidAccessKeyDv(KEY + "0")).toBe(false);
  });

  it("normaliza com espacos e quebras de linha", () => {
    const withBreaks = KEY.match(/.{1,4}/g)!.join(" \n");
    expect(normalizeAccessKey(withBreaks)).toBe(KEY);
  });

  it("recupera O no lugar de 0 e valida", () => {
    const idx = KEY.indexOf("0");
    const withO = KEY.slice(0, idx) + "O" + KEY.slice(idx + 1);
    expect(normalizeAccessKey(fmtKey(withO))).toBe(KEY);
  });

  it("recusa 44 zeros e 44 noves", () => {
    expect(isValidAccessKeyDv("0".repeat(44))).toBe(false);
    expect(isValidAccessKeyDv("9".repeat(44))).toBe(false);
  });

  it("decodifica os campos", () => {
    expect(decodeAccessKey(KEY)).toEqual({
      key: KEY,
      ufCode: "35",
      year: 2026,
      month: 3,
      cnpj: CNPJ,
      model: "65",
      series: "001",
      number: "000001234",
    });
  });

  it("mes 13 devolve null", () => {
    expect(decodeAccessKey(makeKey({ aamm: "2613", cnpj: CNPJ, number: "000000001", cnf: "11111111" }))).toBeNull();
  });
});

describe("isValidCnpj", () => {
  it("valida e recusa DV errado, zeros e 13 digitos", () => {
    expect(isValidCnpj(CNPJ)).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("0".repeat(14))).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });
});

describe("redactCpf", () => {
  it("remove CPF com pontuacao", () => {
    expect(redactCpf("Cliente 123.456.789-09 ok")).not.toContain("123.456.789-09");
  });

  it("remove CPF com 11 digitos depois da palavra CPF", () => {
    expect(redactCpf("CPF: 12345678909")).not.toContain("12345678909");
  });

  it("remove CPF seguido de CONSUMIDOR na mesma linha", () => {
    const out = redactCpf("CPF 123.456.789-09 CONSUMIDOR");
    expect(out).not.toContain("123");
    expect(out).toContain("CPF removido");
  });

  it("nao mexe em chave de 44 digitos nem em CNPJ", () => {
    expect(redactCpf(KEY)).toBe(KEY);
    expect(redactCpf("CNPJ: 11.222.333/0001-81")).toBe("CNPJ: 11.222.333/0001-81");
  });

  it("texto sem CPF fica igual", () => {
    expect(redactCpf("Total R$ 10,00")).toBe("Total R$ 10,00");
  });
});

describe("QR Code", () => {
  const qr = `https://qrcode.exemplo.test/consulta?p=${KEY}|2|1|1|ABCDEF&token=xyz&cpf=12345678909`;

  it("sanitizeQrUrl devolve so host, caminho e p", () => {
    expect(sanitizeQrUrl(qr)).toBe(`https://qrcode.exemplo.test/consulta?p=${KEY}`);
  });

  it("sanitizeQrUrl recusa javascript: e texto solto", () => {
    expect(sanitizeQrUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeQrUrl("texto solto")).toBeNull();
  });

  it("extrai a chave valida do p=", () => {
    expect(extractAccessKeyFromQr(`https://qrcode.exemplo.test/c?p=${KEY}|2|1|1|HASH`)).toBe(KEY);
  });

  it("recusa p com 43 digitos ou DV invalido", () => {
    expect(extractAccessKeyFromQr(`p=${KEY.slice(0, 43)}|2|1|1|H`)).toBeNull();
    expect(extractAccessKeyFromQr(`p=${flipLastDv(KEY)}|2|1|1|H`)).toBeNull();
  });
});

describe("parseReceiptText: nota completa (formato A)", () => {
  it("le estabelecimento, CNPJ pela chave, numero, data, total, itens e soma", () => {
    const r = parse(receipt());
    expect(r.merchantName).toBe("SUPERMERCADO EXEMPLO LTDA");
    expect(r.cnpj).toBe(CNPJ);
    expect(r.cnpjSource).toBe("KEY");
    expect(r.accessKey).toBe(KEY);
    expect(r.accessKeyValid).toBe(true);
    expect(r.documentNumber).toBe("1234");
    expect(r.purchaseDate!.getTime()).toBe(Date.UTC(2026, 2, 9));
    expect(r.totalAmount).toBe(31.03);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ description: "ARROZ TIPO 1 5KG", quantity: 1, unit: "UN", unitPrice: 24.9, totalPrice: 24.9, lineConsistent: true });
    expect(r.itemsSum).toBe(31.03);
    expect(r.totalMismatch).toBeNull();
    expect(r.warnings).toEqual([]);
  });
});

describe("parseReceiptText: formatos de item", () => {
  it("formato B (com x)", () => {
    const r = parse(receipt({ items: ["001 PAO FRANCES 2 UN x 5,79 11,58"], tail: tailWith("VALOR TOTAL R$ 11,58") }));
    expect(r.items[0]).toEqual({ description: "PAO FRANCES", quantity: 2, unit: "UN", unitPrice: 5.79, totalPrice: 11.58, lineConsistent: true });
  });

  it("formato C (duas linhas)", () => {
    const r = parse(receipt({ items: ["CAFE TORRADO 500G", "1 UN x 18,90 18,90"], tail: tailWith("VALOR TOTAL R$ 18,90") }));
    expect(r.items[0]).toEqual({ description: "CAFE TORRADO 500G", quantity: 1, unit: "UN", unitPrice: 18.9, totalPrice: 18.9, lineConsistent: true });
  });

  it("quantidade por peso (0,350 KG x 17,50 6,13)", () => {
    const r = parse(receipt({ items: ["FILE DE FRANGO", "0,350 KG x 17,50 6,13"], tail: tailWith("VALOR TOTAL R$ 6,13") }));
    expect(r.items[0]).toMatchObject({ description: "FILE DE FRANGO", quantity: 0.35, unit: "KG", unitPrice: 17.5, totalPrice: 6.13 });
  });
});

describe("parseReceiptText: soma e divergencia", () => {
  it("diferenca de R$ 0,02 para mais: totalMismatch com sinal positivo", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,05") }));
    expect(r.totalMismatch).toEqual({ itemsSum: 31.03, total: 31.05, difference: 0.02 });
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_TOTAL_MISMATCH);
  });

  it("diferenca de R$ 0,02 para menos: sinal negativo", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,01") }));
    expect(r.totalMismatch).toEqual({ itemsSum: 31.03, total: 31.01, difference: -0.02 });
  });

  it("diferenca de R$ 0,01 nao e divergencia", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,04") }));
    expect(r.totalMismatch).toBeNull();
    expect(r.warnings).not.toContain(RECEIPT_WARNINGS.W_TOTAL_MISMATCH);
  });
});

describe("parseReceiptText: total", () => {
  it("varios candidatos: escolhe o que bate com a soma", () => {
    const r = parse(receipt({ tail: ["TOTAL R$ 20,00", "VALOR TOTAL R$ 31,03", ...tailWith(null)] }));
    expect(r.totalAmount).toBe(31.03);
    expect(r.warnings).not.toContain(RECEIPT_WARNINGS.W_TOTAL_AMBIGUOUS);
  });

  it("nenhum candidato bate: maior e aviso de ambiguidade", () => {
    const r = parse(receipt({ tail: ["VALOR TOTAL R$ 40,00", "VALOR A PAGAR R$ 45,00", ...tailWith(null)] }));
    expect(r.totalAmount).toBe(45);
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_TOTAL_AMBIGUOUS);
  });

  it("ignora linhas de QTD/ITENS e SUBTOTAL", () => {
    const r = parse(receipt({ tail: ["SUBTOTAL R$ 99,00", "QTD. TOTAL DE ITENS 2 VALOR TOTAL 40,00", ...tailWith(null)] }));
    expect(r.totalAmount).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_NO_TOTAL);
  });

  it("sem total: null e W_NO_TOTAL", () => {
    const r = parse(receipt({ tail: tailWith(null) }));
    expect(r.totalAmount).toBeNull();
    expect(r.totalMismatch).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_NO_TOTAL);
  });
});

describe("parseReceiptText: chave (QR e texto)", () => {
  it("QR igual ao texto: sem aviso de conflito", () => {
    const r = parse(receipt(), KEY);
    expect(r.accessKey).toBe(KEY);
    expect(r.warnings).not.toContain(RECEIPT_WARNINGS.W_KEY_CONFLICT);
  });

  it("QR diferente do texto: usa QR e avisa", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,03", KEY_OTHER) }), KEY);
    expect(r.accessKey).toBe(KEY);
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_KEY_CONFLICT);
  });

  it("QR invalida: usa a do texto", () => {
    const r = parse(receipt(), flipLastDv(KEY));
    expect(r.accessKey).toBe(KEY);
    expect(r.warnings).not.toContain(RECEIPT_WARNINGS.W_KEY_CONFLICT);
  });

  it("so QR, sem texto de chave", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,03", null) }), KEY);
    expect(r.accessKey).toBe(KEY);
    expect(r.accessKeyValid).toBe(true);
  });

  it("chave impressa com O no lugar de 0 e recuperada", () => {
    const idx = KEY.indexOf("0");
    const withO = KEY.slice(0, idx) + "O" + KEY.slice(idx + 1);
    const r = parse(receipt({ tail: ["VALOR TOTAL R$ 31,03", "CHAVE DE ACESSO", fmtKey(withO), "09/03/2026 14:32:10"] }));
    expect(r.accessKey).toBe(KEY);
  });
});

describe("parseReceiptText: CNPJ", () => {
  it("sem chave, CNPJ do texto valido: cnpjSource TEXT", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,03", null) }));
    expect(r.cnpj).toBe(CNPJ);
    expect(r.cnpjSource).toBe("TEXT");
    expect(r.warnings).not.toContain(RECEIPT_WARNINGS.W_CNPJ_INVALID);
  });

  it("sem chave, O no lugar de 0 e recuperado no CNPJ", () => {
    const r = parse(receipt({ header: ["SUPERMERCADO EXEMPLO LTDA", "CNPJ: 11.222.333/000l-81"], tail: tailWith("VALOR TOTAL R$ 31,03", null) }));
    expect(r.cnpj).toBe(CNPJ);
  });

  it("CNPJ da chave vence o CNPJ impresso no texto", () => {
    const other = makeCnpj("123456780001");
    const fmt = `${other.slice(0, 2)}.${other.slice(2, 5)}.${other.slice(5, 8)}/${other.slice(8, 12)}-${other.slice(12)}`;
    const r = parse(receipt({ header: ["SUPERMERCADO EXEMPLO LTDA", `CNPJ: ${fmt}`] }));
    expect(r.cnpj).toBe(CNPJ);
    expect(r.cnpjSource).toBe("KEY");
  });

  it("DV errado sem chave: null e W_CNPJ_INVALID", () => {
    const r = parse(receipt({ header: ["SUPERMERCADO EXEMPLO LTDA", "CNPJ: 11.222.333/0001-80"], tail: tailWith("VALOR TOTAL R$ 31,03", null) }));
    expect(r.cnpj).toBeNull();
    expect(r.cnpjSource).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_CNPJ_INVALID);
  });
});

describe("parseReceiptText: numero e data", () => {
  it("numero do texto quando nao ha chave", () => {
    const r = parse(receipt({ header: ["LOJA", "NFC-e n. 000123456"], tail: tailWith("VALOR TOTAL R$ 31,03", null) }));
    expect(r.documentNumber).toBe("123456");
  });

  it("numero no formato N° do texto", () => {
    const r = parse(receipt({ header: ["LOJA", "Nº 987"], tail: tailWith("VALOR TOTAL R$ 31,03", null) }));
    expect(r.documentNumber).toBe("987");
  });

  it("sem numero: null", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,03", null) }));
    expect(r.documentNumber).toBeNull();
  });

  it("duas datas: a da linha com horario vence", () => {
    const r = parse(receipt({ header: ["LOJA", "Emissao 01/03/2026"] }));
    expect(r.purchaseDate!.getTime()).toBe(Date.UTC(2026, 2, 9));
  });

  it("data futura: null e W_DATE_INVALID", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,03", KEY, "20/11/2026 10:00:00") }));
    expect(r.purchaseDate).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_DATE_INVALID);
  });

  it("mes diferente da chave: mantem a data e avisa", () => {
    const r = parse(receipt({ tail: tailWith("VALOR TOTAL R$ 31,03", KEY, "05/04/2026 10:00:00") }));
    expect(r.purchaseDate!.getTime()).toBe(Date.UTC(2026, 3, 5));
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_DATE_KEY_MISMATCH);
  });
});

describe("parseReceiptText: itens", () => {
  it("linha que nao fecha: lineConsistent false e aviso com o numero do item", () => {
    const r = parse(receipt({ items: [ITEMS[0], "002 ARROZ 2 UN 10,00 25,00"], tail: tailWith("VALOR TOTAL R$ 49,90") }));
    expect(r.items[1].lineConsistent).toBe(false);
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_ITEM_LINE(2));
  });

  it("sem itens: W_NO_ITEMS e itemsSum null, sem inventar item", () => {
    const r = parse(receipt({ items: [] }));
    expect(r.items).toEqual([]);
    expect(r.itemsSum).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_NO_ITEMS);
  });
});

describe("parseReceiptText: privacidade", () => {
  it("CPF nao aparece em nenhum campo nem no texto guardado", () => {
    const r = parse(receipt({ header: [...HEADER, "CPF: 123.456.789-09", "CPF 12345678909 CONSUMIDOR"] }));
    expect(r.rawTextRedacted).not.toContain("123.456.789-09");
    expect(r.rawTextRedacted).not.toContain("12345678909");
    const json = JSON.stringify(r);
    expect(json).not.toContain("12345678909");
    expect(json).not.toContain("123.456.789-09");
  });

  it("texto guardado tem no maximo 500 caracteres", () => {
    const r = parse("linha de texto qualquer\n".repeat(200));
    expect(r.rawTextRedacted.length).toBeLessThanOrEqual(500);
  });
});

describe("parseReceiptText: robustez", () => {
  it("texto vazio nao lanca e devolve avisos", () => {
    const r = parse("");
    expect(r.items).toEqual([]);
    expect(r.warnings).toEqual([RECEIPT_WARNINGS.W_DATE_INVALID, RECEIPT_WARNINGS.W_NO_ITEMS, RECEIPT_WARNINGS.W_NO_TOTAL]);
  });

  it.each([
    ["bytes nulos", "\u0000".repeat(1000)],
    ["100000 noves", "9".repeat(100000)],
    ["100000 traços", "-".repeat(100000)],
  ])("%s: nao lanca e termina em menos de 500 ms", (_, text) => {
    const t0 = Date.now();
    expect(() => parse(text)).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
