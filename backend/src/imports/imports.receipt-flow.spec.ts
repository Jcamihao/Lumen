import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as http from 'http';
import * as https from 'https';
import { ImportsService } from './imports.service';
import { ReceiptExtraction } from './receipt-extractor.types';
import { parseReceiptText } from './receipt-text.parser';

// Prisma simulado em memória: respeita o `where` (igualdade, not, contains, gte/lte, Decimal),
// para provar isolamento por userId e a regra de chave duplicada.
type Row = Record<string, any>;

const TODAY = new Date(Date.UTC(2026, 10, 16));
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100),
]);

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) {
      return true;
    }
    const value = row[key];
    if (cond instanceof Prisma.Decimal) {
      return Number(value) === Number(cond.toString());
    }
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (cond === null || typeof cond !== 'object') {
      return value === cond;
    }
    if ('not' in cond) {
      return value !== cond.not;
    }
    if ('contains' in cond) {
      return String(value ?? '').toLowerCase().includes(String(cond.contains).toLowerCase());
    }
    if ('gte' in cond || 'lte' in cond) {
      const time = value instanceof Date ? value.getTime() : Number.NaN;
      if ('gte' in cond && !(time >= cond.gte.getTime())) return false;
      if ('lte' in cond && !(time <= cond.lte.getTime())) return false;
      return true;
    }
    throw new Error(`filtro nao suportado no fake: ${Object.keys(cond).join(',')}`);
  });
}

function createFakePrisma() {
  const db = {
    users: [] as Row[],
    tagGroups: [] as Row[],
    categories: [] as Row[],
    transactions: [] as Row[],
    scans: [] as Row[],
    scanItems: [] as Row[],
  };
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const withItems = (scan: Row, include?: Row) => {
    const items = db.scanItems
      .filter((item) => item.receiptScanId === scan.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const out: Row = { ...scan, items };
    if (include?.transaction) {
      out.transaction = db.transactions.find((t) => t.id === scan.transactionId) ?? null;
    }
    return out;
  };

  const prisma: Row = {
    db,
    user: {
      findUnique: jest.fn(async ({ where }: Row) => db.users.find((u) => u.id === where.id) ?? null),
    },
    tagGroup: {
      findFirst: jest.fn(async ({ where }: Row) => db.tagGroups.find((g) => matches(g, where)) ?? null),
    },
    financeCategory: {
      findFirst: jest.fn(async ({ where }: Row) => db.categories.find((c) => matches(c, where)) ?? null),
      findMany: jest.fn(async ({ where }: Row) =>
        db.categories
          .filter((c) => matches(c, where))
          .map(({ id, name, type }) => ({ id, name, type })),
      ),
    },
    transaction: {
      findFirst: jest.fn(async ({ where }: Row) => db.transactions.find((t) => matches(t, where)) ?? null),
      create: jest.fn(async ({ data }: Row) => {
        const row = { id: nextId('tx'), createdAt: new Date(), ...data };
        db.transactions.push(row);
        return { ...row, category: null, task: null, goal: null };
      }),
    },
    receiptScan: {
      create: jest.fn(async ({ data }: Row) => {
        const { items, ...rest } = data;
        const row = {
          id: nextId('scan'),
          status: 'PREVIEWED',
          transactionId: null,
          importedAt: null,
          subtotalAmount: null,
          taxAmount: null,
          accessKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...rest,
        };
        db.scans.push(row);
        for (const item of items?.create ?? []) {
          db.scanItems.push({ id: nextId('item'), receiptScanId: row.id, unitPrice: null, ...item });
        }
        return withItems(row);
      }),
      findFirst: jest.fn(async ({ where, include }: Row) => {
        const row = db.scans.find((s) => matches(s, where));
        return row ? withItems(row, include) : null;
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = db.scans.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    receiptScanItem: {
      // Sem histórico de preço: a comparação entre notas não é objeto destes testes.
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async ({ where }: Row) => {
        for (let i = db.scanItems.length - 1; i >= 0; i--) {
          if (matches(db.scanItems[i], where)) db.scanItems.splice(i, 1);
        }
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: Row) => {
        for (const item of data) db.scanItems.push({ id: nextId('item'), ...item });
        return { count: data.length };
      }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: Row) => unknown) => fn(prisma));
  return prisma;
}

const money = (value: number) => value.toFixed(2).replace('.', ',');

function noteText(t: Row, options: { dropKey?: boolean; omitItems?: boolean; totalValue?: number; cpf?: boolean } = {}) {
  const cnpj: string = t.cnpj;
  const cnpjFormatted = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
  const lines = [t.merchant, `CNPJ: ${cnpjFormatted}`, 'DANFE NFC-e'];
  if (options.cpf) {
    lines.push('CPF: 123.456.789-09');
  }
  if (!options.omitItems) {
    t.items.forEach((item: Row, index: number) => {
      lines.push(
        `${String(index + 1).padStart(3, '0')} ${item.desc} ${String(item.qty).replace('.', ',')} ${item.un} ${money(item.unit)} ${money(item.total)}`,
      );
    });
  }
  lines.push(`VALOR TOTAL R$ ${money(options.totalValue ?? t.total)}`);
  lines.push(`NFC-e n. ${t.nf} Emissao ${t.date} 10:30:00`);
  if (!options.dropKey) {
    lines.push('CHAVE DE ACESSO');
    lines.push(t.key.match(/.{1,4}/g)!.join(' '));
  }
  lines.push('CONSUMIDOR NAO IDENTIFICADO');
  return lines.join('\n');
}

function extractionFrom(text: string): ReceiptExtraction {
  const parsed = parseReceiptText(text, { today: TODAY });
  return {
    ...parsed,
    extraction: {
      method: 'OCR',
      ocrConfidence: 0.9,
      warnings: [...parsed.warnings],
      qrDetected: false,
      secondPass: false,
    },
    qrCodeText: null,
  };
}

const N1 = {
  merchant: 'SUPERMERCADO BOM PRECO LTDA',
  cnpj: '47555260000197',
  date: '23/02/2026',
  nf: 323537,
  total: 179.94,
  key: '35260247555260000197650010003235371094698109',
  items: [
    { desc: 'FILE DE FRANGO', qty: 1.331, un: 'KG', unit: 17.5, total: 23.29 },
    { desc: 'LEITE INTEGRAL 1L', qty: 2, un: 'UN', unit: 5.79, total: 11.58 },
    { desc: 'REFRIGERANTE COLA 2L', qty: 4, un: 'UN', unit: 9.99, total: 39.96 },
    { desc: 'PAO FRANCES', qty: 1.961, un: 'KG', unit: 14.9, total: 29.22 },
    { desc: 'SABONETE 90G', qty: 1, un: 'UN', unit: 2.49, total: 2.49 },
    { desc: 'PAPEL HIGIENICO 12UN', qty: 1, un: 'UN', unit: 19.9, total: 19.9 },
    { desc: 'MACARRAO ESPAGUETE 500G', qty: 4, un: 'UN', unit: 4.59, total: 18.36 },
    { desc: 'DETERGENTE 500ML', qty: 1, un: 'UN', unit: 2.89, total: 2.89 },
    { desc: 'OLEO DE SOJA 900ML', qty: 1, un: 'UN', unit: 7.35, total: 7.35 },
    { desc: 'ARROZ TIPO 1 5KG', qty: 1, un: 'UN', unit: 24.9, total: 24.9 },
  ],
};

// Nota N2 sem chave repetida com N1 (outro CNPJ e outra chave): usada onde não deve haver duplicata.
const N2 = {
  merchant: 'FARMACIA SAUDE VIVA LTDA',
  cnpj: '51680408000192',
  date: '13/04/2026',
  nf: 556056,
  total: 37.8,
  key: '35260451680408000192650010005560561822711989',
  items: [{ desc: 'CAFE TORRADO 500G', qty: 2, un: 'UN', unit: 18.9, total: 37.8 }],
};

function setup() {
  const prisma = createFakePrisma();
  prisma.db.users.push({ id: 'user-a', timezone: 'America/Sao_Paulo' }, { id: 'user-b', timezone: 'America/Sao_Paulo' });
  prisma.db.tagGroups.push({ id: 'tg-a', userId: 'user-a' });
  prisma.db.categories.push({ id: 'cat-a', userId: 'user-a', type: 'EXPENSE', name: 'Mercado' });
  const extractor = { extract: jest.fn() };
  const lifeEngine = { touchUserData: jest.fn(async () => undefined) };
  const notifications = { createNotification: jest.fn(async () => undefined) };
  const service = new ImportsService(prisma as any, lifeEngine as any, notifications as any, extractor as any);
  return { prisma, extractor, service };
}

function file() {
  return { buffer: PNG_BYTES, size: PNG_BYTES.length, originalname: 'nota.png', mimetype: 'image/png' } as any;
}

async function preview(ctx: ReturnType<typeof setup>, text: string, userId = 'user-a') {
  ctx.extractor.extract.mockResolvedValueOnce(extractionFrom(text));
  return ctx.service.previewReceiptImport(userId, file(), { tagGroupId: 'tg-a' } as any);
}

async function captureError(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error('esperava erro e nao veio');
    },
    (error) => error,
  );
}

jest.setTimeout(30_000);

describe('nota fiscal: previa sem IA e sem rede', () => {
  const selahKeys = ['SELAH_ASSISTANT_ENABLED', 'SELAH_BASE_URL', 'SELAH_API_KEY'];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(selahKeys.map((key) => [key, process.env[key]]));
    selahKeys.forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    selahKeys.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  it('funciona sem consentimento de IA, sem SELAH_* e sem nenhuma chamada de rede', async () => {
    const ctx = setup();
    const selahSpy = jest.spyOn(ctx.service as any, 'parseReceiptWithSelah');
    const httpSpy = jest.spyOn(http, 'request');
    const httpsSpy = jest.spyOn(https, 'request');
    const originalFetch = (globalThis as any).fetch;
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;

    try {
      const response = await preview(ctx, noteText(N1));

      expect(response.totalAmount).toBe(N1.total);
      expect(selahSpy).not.toHaveBeenCalled();
      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      httpSpy.mockRestore();
      httpsSpy.mockRestore();
      (globalThis as any).fetch = originalFetch;
    }
  });

  it('grava accessKey, rawText sem CPF e provider LUMEN_LOCAL, e devolve os campos novos', async () => {
    const ctx = setup();

    const response = await preview(ctx, noteText(N1, { cpf: true }));

    const created = ctx.prisma.receiptScan.create.mock.calls[0][0].data;
    expect(created.accessKey).toBe(N1.key);
    expect(created.rawText).not.toContain('123.456.789-09');
    expect(created.rawText).not.toContain('12345678909');
    expect(created.previewData.provider).toBe('LUMEN_LOCAL');
    expect(response.itemsSum).toBeCloseTo(N1.total, 2);
    expect(response.totalMismatch).toBeNull();
    expect(response.extraction).toMatchObject({ method: 'OCR', secondPass: false });
    expect(response.accessKeyValid).toBe(true);
    expect(response.purchaseSummary).toBeNull();
    expect(response.spendingSignals).toEqual([]);
    expect(response.followUpActions).toEqual([]);
  });

  describe('confianca calculada', () => {
    it('high: chave valida, soma batendo e sem avisos', async () => {
      const response = await preview(setup(), noteText(N1));
      expect(response.confidence).toBe('high');
    });

    it('medium: sem chave valida, mas sem gatilho de baixa', async () => {
      const response = await preview(setup(), noteText(N1, { dropKey: true }));
      expect(response.accessKeyValid).toBe(false);
      expect(response.confidence).toBe('medium');
    });

    it('low: soma dos itens diferente do total', async () => {
      const response = await preview(setup(), noteText(N1, { totalValue: N1.total + 0.5 }));
      expect(response.totalMismatch).toMatchObject({ difference: 0.5 });
      expect(response.confidence).toBe('low');
    });

    it('low: nota sem itens', async () => {
      const response = await preview(setup(), noteText(N1, { omitItems: true }));
      expect(response.items).toEqual([]);
      expect(response.confidence).toBe('low');
    });

    it('low: linha de item que nao fecha (quantidade vezes preco diferente do total da linha)', async () => {
      const broken = { ...N1, items: N1.items.map((item, index) => (index === 0 ? { ...item, qty: 1, unit: 17.5 } : item)) };
      const response = await preview(setup(), noteText(broken));
      expect(response.items[0]).toBeDefined();
      expect(response.confidence).toBe('low');
    });
  });

  it('nota antiga (previewData sem os campos novos) serializa sem erro', async () => {
    const ctx = setup();
    ctx.prisma.db.scans.push({
      id: 'scan-old',
      userId: 'user-a',
      fileName: 'antiga.png',
      merchantName: 'Mercado antigo',
      purchaseDate: new Date(Date.UTC(2026, 1, 10)),
      totalAmount: new Prisma.Decimal(10),
      subtotalAmount: null,
      taxAmount: null,
      confidence: 'medium',
      status: 'PREVIEWED',
      accessKey: null,
      previewData: { notes: [], possibleDuplicate: false, itemCategoryHints: [] },
      createdAt: new Date(),
    });
    const row = await ctx.prisma.receiptScan.findFirst({ where: { id: 'scan-old', userId: 'user-a' }, include: { items: true } });

    const response = await (ctx.service as any).serializeReceiptPreview(row);

    expect(response.itemsSum).toBeNull();
    expect(response.totalMismatch).toBeNull();
    expect(response.extraction).toBeNull();
    expect(response.accessKeyValid).toBe(false);
    expect(response.spendingSignals).toEqual([]);
  });
});

describe('nota fiscal: duplicata exige decisao', () => {
  function seedImported(ctx: ReturnType<typeof setup>, owner: string, key: string, id = 'scan-imported') {
    ctx.prisma.db.transactions.push({ id: `tx-${id}`, userId: owner, type: 'EXPENSE', description: 'Compra antiga', amount: new Prisma.Decimal(1), date: TODAY });
    ctx.prisma.db.scans.push({
      id,
      userId: owner,
      status: 'IMPORTED',
      accessKey: key,
      transactionId: `tx-${id}`,
      previewData: {},
      items: [],
      totalAmount: new Prisma.Decimal(1),
      fileName: 'velha.png',
      mimeType: 'image/png',
      confidence: 'high',
      createdAt: new Date(),
    });
  }

  it('sem acknowledgeDuplicate: 409 RECEIPT_DUPLICATE_UNCONFIRMED e nada gravado', async () => {
    const ctx = setup();
    seedImported(ctx, 'user-a', N1.key);
    const response = await preview(ctx, noteText(N1));
    expect(response.possibleDuplicate).toBe(true);
    expect(response.duplicateTransactionDescription).toBe('Compra antiga');
    ctx.prisma.$transaction.mockClear();
    ctx.prisma.transaction.create.mockClear();

    const error = await captureError(
      ctx.service.commitReceiptImport('user-a', { receiptScanId: response.receiptScanId } as any),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ statusCode: 409, code: 'RECEIPT_DUPLICATE_UNCONFIRMED' });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('com acknowledgeDuplicate true grava a nota', async () => {
    const ctx = setup();
    seedImported(ctx, 'user-a', N1.key);
    const response = await preview(ctx, noteText(N1));

    const result = await ctx.service.commitReceiptImport('user-a', {
      receiptScanId: response.receiptScanId,
      acknowledgeDuplicate: true,
    } as any);

    expect(result.success).toBe(true);
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ctx.prisma.transaction.create).toHaveBeenCalledTimes(1);
  });

  it('chave importada depois da previa bloqueia o commit (reconsulta no commit)', async () => {
    const ctx = setup();
    const response = await preview(ctx, noteText(N1));
    expect(response.possibleDuplicate).toBe(false);
    seedImported(ctx, 'user-a', N1.key);

    const error = await captureError(
      ctx.service.commitReceiptImport('user-a', { receiptScanId: response.receiptScanId } as any),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('chave importada por OUTRO usuario nao bloqueia nem aparece na previa', async () => {
    const ctx = setup();
    seedImported(ctx, 'user-b', N1.key);

    const response = await preview(ctx, noteText(N1));
    expect(response.possibleDuplicate).toBe(false);
    expect(response.duplicateTransactionId).toBeNull();
    expect(response.duplicateTransactionDescription).toBeNull();

    const result = await ctx.service.commitReceiptImport('user-a', { receiptScanId: response.receiptScanId } as any);
    expect(result.success).toBe(true);
  });

  it('toda consulta de nota feita pelo fluxo leva o userId do token', async () => {
    const ctx = setup();
    seedImported(ctx, 'user-a', N1.key);
    const response = await preview(ctx, noteText(N1));
    await ctx.service.commitReceiptImport('user-a', {
      receiptScanId: response.receiptScanId,
      acknowledgeDuplicate: true,
    } as any);

    const scanQueries = [
      ...ctx.prisma.receiptScan.findFirst.mock.calls,
    ].map(([arg]: [Row]) => arg.where);
    expect(scanQueries.length).toBeGreaterThan(0);
    for (const where of scanQueries) {
      expect(where.userId).toBe('user-a');
    }
  });
});

describe('nota fiscal: isolamento entre usuarios', () => {
  it('commit de nota de outro usuario responde 404 igual a inexistente', async () => {
    const ctx = setup();
    const response = await preview(ctx, noteText(N1));

    const foreign = await captureError(
      ctx.service.commitReceiptImport('user-b', { receiptScanId: response.receiptScanId } as any),
    );
    const missing = await captureError(
      ctx.service.commitReceiptImport('user-b', { receiptScanId: 'nao-existe' } as any),
    );

    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(foreign.message).toBe(missing.message);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('nota fiscal: regressao', () => {
  it('commit com o corpo antigo (sem acknowledgeDuplicate) de nota sem duplicata continua gravando', async () => {
    const ctx = setup();
    const response = await preview(ctx, noteText(N2));

    const result = await ctx.service.commitReceiptImport('user-a', { receiptScanId: response.receiptScanId } as any);

    expect(result.success).toBe(true);
    expect(result.importedItems).toBe(1);
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    const scan = ctx.prisma.db.scans.find((s: Row) => s.id === response.receiptScanId);
    expect(scan.status).toBe('IMPORTED');
  });
});
