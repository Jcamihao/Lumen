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

  it("valor bruto bate com os itens e ha outro total (desconto geral): avisa, nao fica calado", () => {
    const r = parse(receipt({ tail: ["VALOR TOTAL R$ 31,03", "VALOR A PAGAR R$ 28,00", ...tailWith(null)] }));
    expect(r.totalAmount).toBe(31.03);
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_TOTAL_MULTIPLE);
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

// =====================================================================================
// Revisao 4a-1 (sonnet). Vetores independentes: chaves e CNPJ abaixo foram calculados
// fora do codigo (outro programa, pesos 2..9 ciclicos da direita para a esquerda) e
// colados como literais. CPF sintetico: 529.982.247-25.
// =====================================================================================

const K1 = "35261111222333000181650010000123451876543214"; // 2611, CNPJ 11222333000181, numero 12345
const K2 = "33261145678912000155650020000007891112233447"; // 2611, CNPJ 45678912000155, numero 789
const CPF = "52998224725";
const CPF_FMT = "529.982.247-25";

// Formulacao diferente da usada no codigo: pesos 2..9 em ciclo indexados pela posicao a partir da direita.
function dvAlt(digits: string): number {
  const total = [...digits].reverse().reduce((s, d, i) => s + Number(d) * (2 + (i % 8)), 0);
  const mod = total % 11;
  return mod <= 1 ? 0 : 11 - mod;
}

// Gerador deterministico (nao usa Math.random para o teste ser repetivel).
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s;
  };
}
const digitsFrom = (next: () => number, n: number) => Array.from({ length: n }, () => String(next() % 10)).join("");

describe("revisao: DV da chave e do CNPJ contra calculo independente", () => {
  it("vetores literais calculados fora do codigo", () => {
    for (const k of [K1, K2, KEY]) {
      expect(dvAlt(k.slice(0, 43))).toBe(Number(k[43]));
      expect(isValidAccessKeyDv(k)).toBe(true);
    }
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("45678912000155")).toBe(true);
    expect(isValidCnpj("00000000000191")).toBe(true); // CNPJ publico do Banco do Brasil
  });

  it("500 chaves aleatorias: aceita com o DV certo, recusa com qualquer outro DV (inclui resto 0 e 1)", () => {
    const next = lcg(42);
    let restoBaixo = 0;
    for (let i = 0; i < 500; i++) {
      const body = digitsFrom(next, 43);
      if (/^(\d)\1{42}$/.test(body)) continue;
      const dv = dvAlt(body);
      const total = [...body].reverse().reduce((s, d, j) => s + Number(d) * (2 + (j % 8)), 0);
      if (total % 11 <= 1) restoBaixo++;
      expect(isValidAccessKeyDv(body + dv)).toBe(true);
      expect(isValidAccessKeyDv(body + ((dv + 1) % 10))).toBe(false);
    }
    expect(restoBaixo).toBeGreaterThan(0); // o ramo "resto 0 ou 1 vira 0" foi exercitado
  });

  it("500 CNPJ aleatorios: DV1 e DV2 independentes", () => {
    const next = lcg(7);
    for (let i = 0; i < 500; i++) {
      const base = digitsFrom(next, 12);
      if (/^(\d)\1{11}$/.test(base)) continue;
      const d1 = dvAlt(base);
      const d2 = dvAlt(base + d1);
      expect(isValidCnpj(base + d1 + d2)).toBe(true);
      expect(isValidCnpj(base + ((d1 + 1) % 10) + d2)).toBe(false);
      expect(isValidCnpj(base + d1 + ((d2 + 1) % 10))).toBe(false);
    }
  });

  it("44 digitos iguais e CNPJ de 14 digitos iguais sao recusados (todos os algarismos)", () => {
    for (const d of "0123456789") {
      expect(isValidAccessKeyDv(d.repeat(44))).toBe(false);
      expect(isValidCnpj(d.repeat(14))).toBe(false);
    }
  });

  it("decodeAccessKey: mes 00 tambem e recusado", () => {
    expect(decodeAccessKey(makeKey({ aamm: "2600", cnpj: CNPJ, number: "000000001", cnf: "11111111" }))).toBeNull();
  });
});

describe("revisao: dinheiro, quantidade, data", () => {
  it.each(["٣٢,٩٠", "３２,９０", "32,９0", "R$ ٣٢,٩٠"])("digito unicode nao vira numero: %s", (raw) => {
    expect(parseBrMoney(raw)).toBeNull();
  });

  it("digito unicode em quantidade, data e chave", () => {
    expect(parseBrQuantity("３")).toBeNull();
    expect(parseBrQuantity("٣")).toBeNull();
    expect(parseBrDate("１６/１１/２０２６", TODAY)).toBeNull();
    expect(normalizeAccessKey("３".repeat(44))).toBeNull();
  });

  it("digito unicode no total do texto nao vira total", () => {
    const r = parse(receipt({ tail: ["VALOR TOTAL R$ ３１,０３", ...tailWith(null)] }));
    expect(r.totalAmount).toBeNull();
  });

  it.each([
    ["999.999.999,99", null],
    ["1.000.000,00", 1000000],
    ["0,01", 0.01],
    ["0,00", null],
    ["1.00,00", null],
    ["1.234.56", null],
    ["1,2", null],
    ["1,234", null],
    [" 32,90 ", 32.9],
    ["R$32,90", 32.9],
  ])("parseBrMoney(%j)", (raw, expected) => {
    expect(parseBrMoney(raw as string)).toBe(expected);
  });

  it("dinheiro sem erro de ponto flutuante: 0,07 e 1.234,57 em centavos exatos", () => {
    expect(parseBrMoney("0,07")).toBe(0.07);
    expect(parseBrMoney("1.234,57")).toBe(1234.57);
  });

  it("soma de itens em centavos exatos: 0,10 + 0,20 fecha com total 0,30", () => {
    const r = parse(receipt({ items: ["001 BALA DE MENTA 1 UN 0,10 0,10", "002 CHICLETE 1 UN 0,20 0,20"], tail: tailWith("VALOR TOTAL R$ 0,30") }));
    expect(r.itemsSum).toBe(0.3);
    expect(r.totalMismatch).toBeNull();
  });

  it("parseBrDate: 29/02 em ano bissexto e nao bissexto, anos de 2 digitos, 2100 e hoje no mesmo dia", () => {
    expect(parseBrDate("29/02/00", TODAY)!.getTime()).toBe(Date.UTC(2000, 1, 29));
    expect(parseBrDate("29/02/24", TODAY)!.getTime()).toBe(Date.UTC(2024, 1, 29));
    expect(parseBrDate("29/02/25", TODAY)).toBeNull();
    expect(parseBrDate("01/01/2100", new Date(Date.UTC(2100, 5, 1)))).toBeNull();
    expect(parseBrDate("00/01/2026", TODAY)).toBeNull();
    expect(parseBrDate("01/00/2026", TODAY)).toBeNull();
    expect(parseBrDate("01/13/2026", TODAY)).toBeNull();
    // "hoje" as 23:59:59 UTC: a mesma data vale, o dia seguinte nao.
    const lateToday = new Date(Date.UTC(2026, 10, 16, 23, 59, 59));
    expect(parseBrDate("16/11/2026", lateToday)).not.toBeNull();
    expect(parseBrDate("17/11/2026", lateToday)).toBeNull();
  });

  it("'hoje' invalido (NaN) nao deixa passar data futura", () => {
    expect(parseBrDate("01/01/2099", new Date(NaN))).toBeNull();
  });

  it("data lida e sempre meia-noite UTC, em qualquer fuso do processo", () => {
    const d = parse(receipt()).purchaseDate!;
    expect(d.getUTCHours() + d.getUTCMinutes() + d.getUTCSeconds() + d.getUTCMilliseconds()).toBe(0);
    expect(d.getTime()).toBe(Date.UTC(2026, 2, 9));
  });
});

describe("revisao: tolerancia de centavos (limite exato)", () => {
  const one = (line: string, total: string) => parse(receipt({ items: [line], tail: tailWith(`VALOR TOTAL R$ ${total}`) }));

  it("linha de item: 1 centavo de diferenca fecha, 2 centavos nao", () => {
    expect(one("001 CAFE 1 UN 10,00 10,01", "10,01").items[0].lineConsistent).toBe(true);
    expect(one("001 CAFE 1 UN 10,00 9,99", "9,99").items[0].lineConsistent).toBe(true);
    const bad = one("001 CAFE 1 UN 10,00 10,02", "10,02");
    expect(bad.items[0].lineConsistent).toBe(false);
    expect(bad.warnings).toContain(RECEIPT_WARNINGS.W_ITEM_LINE(1));
    expect(one("001 CAFE 1 UN 10,00 9,98", "9,98").items[0].lineConsistent).toBe(false);
  });

  it("total x soma: 0,01 nao e divergencia, 0,02 e, nos dois sentidos", () => {
    expect(one("001 CAFE 1 UN 10,00 10,00", "10,01").totalMismatch).toBeNull();
    expect(one("001 CAFE 1 UN 10,00 10,00", "9,99").totalMismatch).toBeNull();
    expect(one("001 CAFE 1 UN 10,00 10,00", "10,02").totalMismatch).toEqual({ itemsSum: 10, total: 10.02, difference: 0.02 });
    expect(one("001 CAFE 1 UN 10,00 10,00", "9,98").totalMismatch).toEqual({ itemsSum: 10, total: 9.98, difference: -0.02 });
  });

  it("quantidade fracionada: 0,333 x 3,00 = 0,999 fecha com 1,00", () => {
    expect(one("001 QUEIJO 0,333 KG x 3,00 1,00", "1,00").items[0].lineConsistent).toBe(true);
  });
});

describe("revisao: privacidade do CPF (redactCpf)", () => {
  // Vazou = algum pedaco de 4 digitos do CPF aparece no resultado, com ou sem O/l/S no lugar do digito.
  // (Os 8 pedacos de 4 digitos deste CPF nao existem nas chaves e CNPJ de teste, conferido a parte.)
  const leaks = (s: string) => {
    const flat = fixNumericOcr(s).replace(/[^0-9]/g, "");
    return [0, 1, 2, 3, 4, 5, 6].some((i) => flat.includes(CPF.slice(i, i + 4)));
  };

  it.each([
    ["pontuado solto", `Cliente ${CPF_FMT} ok`],
    ["11 digitos depois de CPF", `CPF: ${CPF}`],
    ["CPF/CNPJ", `CPF/CNPJ: ${CPF_FMT}`],
    ["rotulo longo, pontuado", `CPF/CNPJ do Consumidor: ${CPF_FMT}`],
    ["rotulo longo, 11 digitos", `CPF/CNPJ do Consumidor: ${CPF}`],
    ["espacos", "CPF: 529 982 247 25"],
    ["traco separado", "CPF 529.982.247 -25"],
    ["C.P.F.", `C.P.F. ${CPF}`],
    ["minusculas", `cpf: ${CPF}`],
    ["misto", `Cpf ${CPF_FMT}`],
    ["colado nos digitos", `CPF${CPF}`],
    ["dois pontos colados", `CPF:${CPF}`],
    ["OCR no rotulo e nos digitos", "CPF: 529.982.247-2S"],
    ["OCR sem rotulo", "529.982.247-2S"],
    ["espacos sem rotulo", "529 982 247 25"],
    ["traco separado sem rotulo", "529.982.247 -25"],
    ["CONSUMIDOR e CPF na linha de baixo, pontuado", `CONSUMIDOR\n${CPF_FMT}`],
    ["CONSUMIDOR e CPF na linha de baixo, 11 digitos", `CONSUMIDOR\n${CPF}`],
    ["CPF e digitos na linha de baixo", `CPF\n${CPF}`],
    ["CONSUMIDOR e 11 digitos na mesma linha", `CONSUMIDOR: ${CPF}`],
    ["CPF antes de CONSUMIDOR", `CPF ${CPF_FMT} CONSUMIDOR`],
    ["OCR trocando 5 por S, 2 por Z nao e coberto, mas o rotulo cobre", "CPF: SZ9.982.247-25"],
  ])("%s", (_name, text) => {
    const out = redactCpf(text);
    expect(leaks(out)).toBe(false);
    expect(out).toContain("CPF removido");
  });

  it("CPF mascarado nao quebra: o que sobra nao identifica ninguem e o rotulo some", () => {
    const out = redactCpf("CPF: ***.982.247-**");
    expect(out).not.toContain("982.247");
    expect(redactCpf("***.982.247-**")).toBe("***.982.247-**"); // sem rotulo, nada a remover
  });

  it("CPF colado a uma chave de 44 digitos nao apaga a chave", () => {
    const out = redactCpf(`CPF ${CPF_FMT} ${K1}`);
    expect(out).toContain(K1);
    expect(leaks(out)).toBe(false);
    const grouped = redactCpf(`CPF ${CPF_FMT} ${fmtKey(K1)}`);
    expect(grouped).toContain(fmtKey(K1));
    expect(leaks(grouped)).toBe(false);
  });

  it("CPF colado em CNPJ formatado nao apaga o CNPJ", () => {
    const out = redactCpf(`CONSUMIDOR CPF ${CPF} CNPJ 11.222.333/0001-81`);
    expect(out).toContain("11.222.333/0001-81");
    expect(leaks(out)).toBe(false);
  });

  it("CPF sem separador nenhum de 55 digitos junto da chave: o CPF some", () => {
    expect(leaks(redactCpf(`CPF${CPF}${K1}`))).toBe(false);
  });

  it("nao apaga chave sozinha, CNPJ, total, valores com milhar e datas", () => {
    const text = [`CHAVE DE ACESSO`, fmtKey(K1), K2, "CNPJ: 11.222.333/0001-81", "VALOR TOTAL R$ 1.234.567,89", "TOTAL 529,98", "16/11/2026 10:15:32", "123.456.789,09"].join("\n");
    expect(redactCpf(text)).toBe(text);
  });

  it("nao apaga linha de 11 digitos que nao esta embaixo de CPF ou CONSUMIDOR", () => {
    expect(redactCpf(`PROTOCOLO\n${CPF}`)).toBe(`PROTOCOLO\n${CPF}`);
  });

  it("espacos unicode e caracteres de largura zero no meio do CPF no texto completo", () => {
    const nbsp = String.fromCharCode(0xa0);
    const zw = String.fromCharCode(0x200b);
    const r = parse(receipt({ header: [...HEADER, `CPF:${nbsp}529.982${zw}.247-25`, `CONSUMIDOR${nbsp}${CPF}`] }));
    expect(leaks(r.rawTextRedacted)).toBe(false);
    expect(leaks(JSON.stringify(r))).toBe(false);
  });

  it("parseReceiptText: CPF em qualquer variante nao aparece em nenhum campo, nem na descricao do item nem no estabelecimento", () => {
    const variants = [
      `CPF ${CPF_FMT}`,
      `CPF: ${CPF}`,
      `CPF/CNPJ: ${CPF_FMT}`,
      `CONSUMIDOR\n${CPF}`,
      `${CPF_FMT} CONSUMIDOR`,
      `CPF ${CPF_FMT} ${fmtKey(KEY)}`,
    ];
    for (const v of variants) {
      const r = parse(receipt({ header: ["SUPERMERCADO EXEMPLO LTDA", v, "CNPJ: 11.222.333/0001-81"] }));
      expect(leaks(JSON.stringify(r))).toBe(false);
    }
    const asMerchant = parse(`JOAO DA SILVA ${CPF_FMT}\n${ITEMS.join("\n")}\nVALOR TOTAL R$ 31,03`);
    expect(asMerchant.merchantName).not.toBeNull();
    expect(leaks(JSON.stringify(asMerchant))).toBe(false);
    const inDescription = parse(`LOJA\n001 FILE CPF ${CPF_FMT} 1 UN 5,00 5,00\nVALOR TOTAL R$ 5,00`);
    expect(inDescription.items).toHaveLength(1);
    expect(leaks(JSON.stringify(inDescription))).toBe(false);
    const bareInDescription = parse(`LOJA\n001 FILE ${CPF_FMT} 1 UN 5,00 5,00\nVALOR TOTAL R$ 5,00`);
    expect(bareInDescription.items).toHaveLength(1);
    expect(leaks(JSON.stringify(bareInDescription))).toBe(false);
  });

  it("com CPF na mesma linha da chave, a chave ainda e lida (o parser trabalha no texto original)", () => {
    const r = parse(["LOJA", "CHAVE DE ACESSO", `CPF ${CPF_FMT} ${fmtKey(K1)}`, "16/11/2026 10:00:00"].join("\n"));
    expect(r.accessKey).toBe(K1);
    expect(leaks(JSON.stringify(r))).toBe(false);
  });

  it("numero do documento nunca recebe pedaco de CPF", () => {
    expect(parse(`LOJA\nNº ${CPF_FMT}`).documentNumber).toBeNull();
    expect(parse(`LOJA\nNFC-e n. ${CPF_FMT}`).documentNumber).toBeNull();
    expect(parse(`LOJA\nNº ${CPF}`).documentNumber).toBeNull();
  });

  it("rawTextRedacted tem exatamente 500 caracteres quando o texto e maior, e redige antes de cortar", () => {
    const text = `${"x".repeat(495)} CPF ${CPF_FMT}\nfim`;
    const r = parse(text);
    expect(r.rawTextRedacted).toHaveLength(500);
    expect(leaks(r.rawTextRedacted)).toBe(false);
    expect(parse("a\n\n\n\n\nb").rawTextRedacted).toBe("a\n\nb");
  });
});

describe("revisao: robustez e ReDoS (limite 500 ms)", () => {
  const N = 200000;
  it.each([
    ["200000 digitos", "9".repeat(N)],
    ["200000 espacos", " ".repeat(N)],
    ["200000 'a'", "a".repeat(N)],
    ["'1.' repetido", "1.".repeat(N / 2)],
    ["CHAVE DE ACESSO repetido", "CHAVE DE ACESSO ".repeat(N / 16)],
    ["'001 ' repetido", "001 ".repeat(N / 4)],
    ["linhas '001 '", "001 \n".repeat(N / 5)],
    ["TOTAL e digitos", "TOTAL " + "9".repeat(N)],
    ["TOTAL e '1.'", "TOTAL " + "1.".repeat(N / 2)],
    ["TOTAL e milhares", "TOTAL " + "1.000".repeat(N / 5)],
    ["VALOR TOTAL R$ repetido", "VALOR TOTAL R$ 1,00 ".repeat(N / 20)],
    ["'1 ' repetido", "1 ".repeat(N / 2)],
    ["'l ' repetido", "l ".repeat(N / 2)],
    ["CPF repetido", "CPF ".repeat(N / 4)],
    ["CPF em linhas", "CPF\n".repeat(N / 4)],
    ["CONSUMIDOR em linhas", "CONSUMIDOR\n12345678909\n".repeat(N / 24)],
    ["pontos de CPF", "123.456.789-0".repeat(N / 13)],
    ["NFC-e repetido", "NFC-e ".repeat(N / 6)],
    ["Nº repetido", "Nº ".repeat(N / 3)],
    ["datas", "01/01/2026 ".repeat(N / 11)],
    ["200000 quebras de linha", "\n".repeat(N)],
    ["11 digitos repetidos", "12345678909 ".repeat(N / 12)],
    ["linhas de item longas", ("1 A ".repeat(120) + "\n").repeat(400)],
    ["linhas de item com valores", ("A 1 UN 1,00 ".repeat(40) + "\n").repeat(400)],
    ["acima do limite", "z".repeat(N * 3)],
  ])("%s", (_name, text) => {
    const t0 = Date.now();
    let r!: ReturnType<typeof parse>;
    expect(() => {
      r = parse(text);
    }).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.rawTextRedacted.length).toBeLessThanOrEqual(500);
  });

  it("fuzz com alfabeto de cupom: nunca lanca e e rapido", () => {
    const alphabet = ["1", "2", "0", ",", ".", " ", "\n", "UN", "x", "R$", "TOTAL", "CPF", "O", "l", "-", "/", ":", "N", "º", "NFC-e", "CHAVE DE ACESSO"];
    const next = lcg(99);
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) {
      const text = Array.from({ length: 400 }, () => alphabet[next() % alphabet.length]).join("");
      expect(() => parse(text)).not.toThrow();
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("entradas que nao sao texto nao lancam", () => {
    for (const bad of [undefined, null, 42, {}, []] as unknown[]) {
      expect(() => parseReceiptText(bad as string, { today: TODAY })).not.toThrow();
    }
    expect(() => parseReceiptText("x", undefined as never)).not.toThrow();
    expect(() => parse("𐀀\uD800 \uDFFF binario \u0001\u0002")).not.toThrow();
  });

  it("texto acima de 200000 caracteres e truncado antes de processar", () => {
    const afterLimit = "z".repeat(200000) + "\nVALOR TOTAL R$ 10,00";
    expect(parse(afterLimit).totalAmount).toBeNull();
    const beforeLimit = "VALOR TOTAL R$ 10,00\n" + "z".repeat(200000);
    expect(parse(beforeLimit).totalAmount).toBe(10);
  });
});

describe("revisao: total", () => {
  const withTotalLine = (line: string) => parse(receipt({ tail: [line, "VALOR TOTAL R$ 31,03", ...tailWith(null)] }));

  it.each([
    "TOTAL QTD R$ 99,00",
    "QTD. TOTAL 99,00",
    "TOTAL ITENS R$ 99,00",
    "TOTAL DESCONTO R$ 99,00",
    "TOTAL DESCONTOS R$ 99,00",
    "TROCO TOTAL R$ 99,00",
    "TOTAL DE TRIBUTOS R$ 99,00",
    "SUBTOTAL R$ 99,00",
    "TOTAL PAGO R$ 99,00",
    "TOTAL DE IMPOSTOS R$ 99,00",
  ])("linha '%s' nao vira candidato a total", (line) => {
    // Sozinha, a linha nao pode virar total (so assim o filtro de cada palavra e exercitado:
    // com um total verdadeiro ao lado, a soma dos itens desempataria e esconderia o erro).
    const alone = parse(receipt({ tail: [line, ...tailWith(null)] }));
    expect(alone.totalAmount).toBeNull();
    expect(alone.warnings).toContain(RECEIPT_WARNINGS.W_NO_TOTAL);
    const r = withTotalLine(line);
    expect(r.totalAmount).toBe(31.03);
    expect(r.warnings).not.toContain(RECEIPT_WARNINGS.W_TOTAL_AMBIGUOUS);
  });

  it("produto com 'TOTAL' no nome nao e total", () => {
    const r = parse(["LOJA", "001 DETERGENTE TOTAL CLEAN 1 UN 5,00 5,00", "16/11/2026 10:00:00"].join("\n"));
    expect(r.items).toHaveLength(1);
    expect(r.totalAmount).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_NO_TOTAL);
  });

  it("'1234.567,89' nao e lido como '234.567,89'", () => {
    expect(parse("LOJA\nVALOR TOTAL R$ 1234.567,89").totalAmount).toBeNull();
  });

  it("total acima de R$ 1.000.000,00 e recusado", () => {
    expect(parse("LOJA\nVALOR TOTAL R$ 1.000.000,01").totalAmount).toBeNull();
    expect(parse("LOJA\nVALOR TOTAL R$ 1.000.000,00").totalAmount).toBe(1000000);
  });

  it("varios candidatos iguais viram um so", () => {
    const r = parse(receipt({ tail: ["TOTAL R$ 31,03", "VALOR A PAGAR R$ 31,03", ...tailWith("VALOR TOTAL R$ 31,03")] }));
    expect(r.totalAmount).toBe(31.03);
    expect(r.warnings).toEqual([]);
  });
});

describe("revisao: numero do documento", () => {
  it("'NFC-e Serie 001' nao vira numero 1", () => {
    expect(parse("LOJA\nNFC-e Serie 001 Emissao 16/11/2026 10:00:00").documentNumber).toBeNull();
  });
  it("milhar com ponto e zeros a esquerda", () => {
    expect(parse("LOJA\nNFC-e Nº 000.123.456").documentNumber).toBe("123456");
    expect(parse("LOJA\nNº 000.000.000").documentNumber).toBeNull();
    expect(parse("LOJA\nNFC-e n. 0").documentNumber).toBeNull();
  });
  it("a chave valida vence o texto", () => {
    expect(parse(`LOJA\nNFC-e n. 999\nCHAVE DE ACESSO\n${fmtKey(K1)}`).documentNumber).toBe("12345");
  });
});

describe("revisao: chave, QR e CNPJ", () => {
  it("chave do QR valida vence a do texto e o conflito gera aviso; invalida do QR nao gera conflito", () => {
    const text = receipt({ tail: ["VALOR TOTAL R$ 31,03", "CHAVE DE ACESSO", fmtKey(K2), "16/11/2026 10:00:00"] });
    const r = parse(text, K1);
    expect(r.accessKey).toBe(K1);
    expect(r.cnpj).toBe("11222333000181");
    expect(r.cnpjSource).toBe("KEY");
    expect(r.warnings.filter((w) => w === RECEIPT_WARNINGS.W_KEY_CONFLICT)).toHaveLength(1);
    const r2 = parse(text, flipLastDv(K1));
    expect(r2.accessKey).toBe(K2);
    expect(r2.warnings).not.toContain(RECEIPT_WARNINGS.W_KEY_CONFLICT);
  });

  it("chave so em OCR (O no lugar de 0, l no lugar de 1) e recuperada; CNPJ vem da chave", () => {
    const ocr = fmtKey(K1).replace(/0/g, "O").replace(/1/g, "l");
    const r = parse(["LOJA", "CHAVE DE ACESSO", ocr, "16/11/2026 10:00:00"].join("\n"));
    expect(r.accessKey).toBe(K1);
    expect(r.cnpjSource).toBe("KEY");
  });

  it("fixNumericOcr nao e aplicado a descricao de item", () => {
    const r = parse(["LOJA", "001 BOLO SOBRE LISO 1 UN 5,00 5,00", "VALOR TOTAL R$ 5,00"].join("\n"));
    expect(r.items[0].description).toBe("BOLO SOBRE LISO");
  });

  it("chave com 44 digitos iguais no texto nao vale", () => {
    const r = parse(["LOJA", "CHAVE DE ACESSO", "0".repeat(44), "16/11/2026 10:00:00"].join("\n"));
    expect(r.accessKey).toBeNull();
    expect(r.accessKeyValid).toBe(false);
  });

  it("chave com DV certo e mes 13 nao vale", () => {
    const bad = makeKey({ aamm: "2613", cnpj: CNPJ, number: "000000001", cnf: "11111111" });
    expect(parse(["LOJA", "CHAVE DE ACESSO", bad].join("\n")).accessKey).toBeNull();
  });

  it("CNPJ de 14 digitos iguais no texto e recusado com aviso", () => {
    const r = parse(["LOJA", "CNPJ: 00.000.000/0000-00"].join("\n"));
    expect(r.cnpj).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_CNPJ_INVALID);
  });

  it("sanitizeQrUrl: sem credenciais, sem fragmento, sem parametros alem de p", () => {
    const out = sanitizeQrUrl(`https://user:senha@qr.exemplo.test:8443/nfce/consulta?cpf=${CPF}&p=${K1}|2|1|1|H&x=1#frag`);
    expect(out).toBe(`https://qr.exemplo.test:8443/nfce/consulta?p=${K1}`);
    expect(sanitizeQrUrl("https://qr.exemplo.test/c?p=123&cpf=1")).toBe("https://qr.exemplo.test/c");
    expect(sanitizeQrUrl("ftp://qr.exemplo.test/c")).toBeNull();
    expect(sanitizeQrUrl("")).toBeNull();
    expect(sanitizeQrUrl("x".repeat(3000))).toBeNull();
  });

  it("extractAccessKeyFromQr: recusa 45 digitos e chave de outro parametro", () => {
    expect(extractAccessKeyFromQr(`https://q.test/c?p=${K1}0|2`)).toBeNull();
    expect(extractAccessKeyFromQr(`https://q.test/c?op=${K1}`)).toBeNull();
    expect(extractAccessKeyFromQr(`https://q.test/c?a=1&p=${K1}`)).toBe(K1);
  });
});

describe("revisao: layouts sinteticos de cupom (NFC-e, SAT e supermercado)", () => {
  const nfceSp = [
    "SUPERMERCADO BOA COMPRA LTDA",
    "CNPJ: 11.222.333/0001-81 IE: 123.456.789.110",
    "RUA DAS FLORES, 100 - CENTRO - SAO PAULO - SP",
    "DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletronica",
    "Codigo Descricao Qtde Un Vl Unit Vl Total",
    "001 7891000100103 ARROZ TIPO 1 5KG 1 UN 24,90 24,90",
    "002 7894900011517 REFRIGERANTE COLA 2L 2 UN 8,99 17,98",
    "003 2000123 FILE DE FRANGO 0,350 KG x 17,50 6,13",
    "Qtd. total de itens 3",
    "Valor total R$ 49,01",
    "Desconto R$ 0,00",
    "Valor a pagar R$ 49,01",
    "FORMA DE PAGAMENTO VALOR PAGO",
    "Cartao de Credito 49,01",
    "Troco R$ 0,00",
    "Informacao dos Tributos Totais Incidentes (Lei Federal 12.741/2012) R$ 8,23",
    "Consulte pela Chave de Acesso em www.fazenda.exemplo.test/nfce/consulta",
    "CHAVE DE ACESSO",
    fmtKey(K1).slice(0, 29),
    fmtKey(K1).slice(30),
    `CONSUMIDOR - CPF ${CPF_FMT}`,
    "NFC-e n. 12345 Serie 1 Emissao 16/11/2026 10:15:32",
    "Protocolo de autorizacao: 135260000123456",
  ].join("\n");

  it("NFC-e: le tudo, chave em duas linhas, sem aviso e sem CPF", () => {
    const r = parse(nfceSp);
    expect(r.merchantName).toBe("SUPERMERCADO BOA COMPRA LTDA");
    expect(r.cnpj).toBe("11222333000181");
    expect(r.cnpjSource).toBe("KEY");
    expect(r.accessKey).toBe(K1);
    expect(r.documentNumber).toBe("12345");
    expect(r.purchaseDate!.getTime()).toBe(Date.UTC(2026, 10, 16));
    expect(r.items.map((i) => [i.description, i.quantity, i.unit, i.unitPrice, i.totalPrice])).toEqual([
      ["ARROZ TIPO 1 5KG", 1, "UN", 24.9, 24.9],
      ["REFRIGERANTE COLA 2L", 2, "UN", 8.99, 17.98],
      ["FILE DE FRANGO", 0.35, "KG", 17.5, 6.13],
    ]);
    expect(r.itemsSum).toBe(49.01);
    expect(r.totalAmount).toBe(49.01); // nao pega tributos (8,23), valor pago nem troco
    expect(r.warnings).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(CPF);
    expect(JSON.stringify(r)).not.toContain(CPF_FMT);
  });

  it("NFC-e: EAN de 13 digitos nunca vira quantidade nem entra na descricao", () => {
    const r = parse(nfceSp);
    for (const i of r.items) {
      expect(i.quantity).toBeLessThan(100);
      expect(i.description).not.toMatch(/\d{7,}/);
    }
  });

  it("duas linhas (EAN e descricao em cima, quantidade embaixo)", () => {
    const r = parse(
      ["PADARIA PAO QUENTE LTDA", "CNPJ: 11.222.333/0001-81", "7891000100103 ARROZ TIPO 1 5KG", "1 UN x 24,90 24,90", "7894900011517 REFRIGERANTE COLA 2L", "2 UN x 8,99 17,98", "VALOR TOTAL R$ 42,88", "16/11/2026 11:11:11"].join("\n"),
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[1]).toMatchObject({ description: "REFRIGERANTE COLA 2L", quantity: 2, unitPrice: 8.99, totalPrice: 17.98 });
    expect(r.totalAmount).toBe(42.88);
    expect(r.warnings).toEqual([]);
  });

  it("cupom SAT com subtotal, desconto geral, dinheiro e troco: total e o 'TOTAL R$', divergencia e avisada", () => {
    const r = parse(
      [
        "MERCADO ESTRELA",
        "CNPJ 45.678.912/0001-55",
        "CUPOM FISCAL ELETRONICO - SAT",
        "CCF 012345 COO 054321",
        "16/11/2026 18:42:10",
        "ITEM CODIGO DESCRICAO QTD UN VL UNIT R$ VL ITEM R$",
        "001 0000123 LEITE INTEGRAL 1L 6 UN x 4,99 29,94",
        "002 7891234567895 PAO DE FORMA 1 UN x 7,50 7,50",
        "SUBTOTAL 37,44",
        "DESCONTO 2,44",
        "TOTAL R$ 35,00",
        "DINHEIRO 50,00",
        "TROCO 15,00",
        "Tributos aprox. R$ 6,10 (Fonte IBPT)",
        `CPF do consumidor: ${CPF_FMT}`,
      ].join("\n"),
    );
    expect(r.cnpj).toBe("45678912000155");
    expect(r.cnpjSource).toBe("TEXT");
    expect(r.items).toHaveLength(2);
    expect(r.totalAmount).toBe(35);
    expect(r.totalMismatch).toEqual({ itemsSum: 37.44, total: 35, difference: -2.44 });
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_TOTAL_MISMATCH);
    expect(JSON.stringify(r)).not.toContain(CPF);
  });

  it("desconto por item em linha separada: leitura certa e a divergencia aparece (nao e silenciosa)", () => {
    const r = parse(
      ["MERCEARIA DO ZE", "CNPJ: 11.222.333/0001-81", "001 7891000100103 ARROZ TIPO 1 5KG 1 UN X 24,90 24,90", "Desconto item -2,00", "002 7894900011517 REFRIGERANTE COLA 2L 1 UN X 8,99 8,99", "TOTAL R$ 31,89", "Valor pago R$ 50,00", "Troco R$ 18,11", "16/11/2026 09:00:00"].join("\n"),
    );
    expect(r.totalAmount).toBe(31.89);
    expect(r.itemsSum).toBe(33.89);
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_TOTAL_MISMATCH);
  });

  it("valor pago e troco nunca viram total", () => {
    const r = parse(["LOJA", "001 ARROZ 5KG 1 UN 24,90 24,90", "TOTAL PAGO 30,00", "Troco 5,10", "16/11/2026 11:11:11"].join("\n"));
    expect(r.totalAmount).toBeNull();
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_NO_TOTAL);
  });

  it("quantidade de 8 digitos (parece EAN-8) fica marcada como linha que nao fecha", () => {
    const r = parse(["LOJA", "PRODUTO 12345678 UN 24,90 24,90", "VALOR TOTAL R$ 24,90"].join("\n"));
    expect(r.items.every((i) => !i.lineConsistent)).toBe(true);
    expect(r.warnings).toContain(RECEIPT_WARNINGS.W_ITEM_LINE(1));
  });

  // Layouts que o parser NAO le. O que importa: falham alto (aviso), nunca com valor errado aceito.
  it.each([
    ["estilo 'Codigo: Descricao: Qtde: UN:' numa linha so", "Codigo: 123 Descricao: ARROZ 5KG Qtde: 1 UN: UN Vl Unit: 24,90 Vl Total: 24,90\nTotal R$ 24,90", RECEIPT_WARNINGS.W_NO_ITEMS],
    ["unidade colada na quantidade (1UN)", "001 ARROZ 5KG 1UN 24,90 24,90\nTotal R$ 24,90", RECEIPT_WARNINGS.W_NO_ITEMS],
    ["unidade antes dos valores sem preco unitario", "002 PRODUTO LONGO 12345678 UN 3 5,00 15,00\nTotal R$ 15,00", RECEIPT_WARNINGS.W_NO_ITEMS],
    ["valor do total na linha de baixo", "001 ARROZ 5KG 1 UN 24,90 24,90\nVALOR TOTAL R$\n24,90", RECEIPT_WARNINGS.W_NO_TOTAL],
  ])("nao suportado, falha com aviso: %s", (_name, body, warning) => {
    const r = parse(`LOJA TESTE\n${body}\n16/11/2026 11:11:11`);
    expect(r.warnings).toContain(warning);
    expect(r.items.every((i) => i.totalPrice > 0)).toBe(true);
  });
});
