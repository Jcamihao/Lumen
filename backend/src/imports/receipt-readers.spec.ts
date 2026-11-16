import * as fs from 'fs';
import * as path from 'path';
import { decodeQr, OcrPool, OcrTimeoutError, PdfJsImporter, readPdfText, sharp } from './receipt-readers';
import { extractAccessKeyFromQr, parseReceiptText } from './receipt-text.parser';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures', 'receipts');
const truth = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'truth.json'), 'utf8'));
const n1 = truth[0];
const TODAY = new Date(Date.UTC(2026, 10, 16));

// OCR real em máquina saturada (suíte inteira com vários workers) chegou a passar de 90 s e
// derrubava o teste por tempo. Os prazos abaixo são folgados de propósito; a regra de prazo
// é testada com 1 ms.
jest.setTimeout(300_000);
const PATIENT_OCR_MS = 250_000;

describe('decodeQr', () => {
  it('le o QR da nota sintetica e a chave bate com o gabarito', async () => {
    const png = fs.readFileSync(path.join(FIXTURES, 'nota-n1.png'));
    const raw = await decodeQr(png);

    expect(raw).not.toBeNull();
    expect(extractAccessKeyFromQr(raw!)).toBe(n1.key);
  });

  it('imagem sem QR devolve null', async () => {
    const blank = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    expect(await decodeQr(blank)).toBeNull();
  });

  it('com prazo zero devolve null rapido, sem lancar', async () => {
    const png = fs.readFileSync(path.join(FIXTURES, 'nota-n1.png'));
    const started = Date.now();

    await expect(decodeQr(png, 0)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('OcrPool', () => {
  const pool = new OcrPool();
  afterAll(() => pool.onModuleDestroy());

  it('reconhece o texto da nota com VALOR TOTAL e o total do gabarito', async () => {
    const png = fs.readFileSync(path.join(FIXTURES, 'nota-n1.png'));
    const { text, confidence } = await pool.recognize(png, PATIENT_OCR_MS);
    const parsed = parseReceiptText(text, { today: TODAY });

    expect(text).toContain('VALOR TOTAL');
    expect(parsed.totalAmount).toBe(n1.total);
    expect(confidence).toBeGreaterThan(0);
  });

  it('com prazo de 1 ms rejeita, tira o worker do pool e a proxima chamada funciona', async () => {
    const png = fs.readFileSync(path.join(FIXTURES, 'nota-n1.png'));
    await pool.recognize(png, PATIENT_OCR_MS);
    expect(pool.size).toBe(1);

    await expect(pool.recognize(png, 1)).rejects.toBeInstanceOf(OcrTimeoutError);
    expect(pool.size).toBe(0);

    const again = await pool.recognize(png, PATIENT_OCR_MS);
    expect(again.text).toContain('VALOR TOTAL');
    expect(pool.size).toBe(1);
  });
});

describe('readPdfText', () => {
  function fakeImporter(options: {
    pages: Array<Array<{ str: string; hasEOL?: boolean }>>;
    failTextContent?: boolean;
    destroy: jest.Mock;
    getPage: jest.Mock;
  }): PdfJsImporter {
    return async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: options.pages.length,
          getPage: options.getPage,
          destroy: options.destroy,
        }),
      }),
    });
  }

  it('junta os itens, quebra linha em hasEOL e separa paginas', async () => {
    const pages = [
      [{ str: 'MERCADO', hasEOL: true }, { str: 'TOTAL ' }, { str: '10,00', hasEOL: true }],
      [{ str: 'PAGINA 2', hasEOL: true }],
    ];
    const destroy = jest.fn();
    const getPage = jest.fn(async (n: number) => ({
      getTextContent: async () => ({ items: pages[n - 1] }),
    }));
    const importer = fakeImporter({ pages, destroy, getPage });

    const text = await readPdfText(Buffer.from('x'), importer);

    expect(text).toBe('MERCADO\nTOTAL 10,00\n\nPAGINA 2\n');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('le no maximo 3 paginas de um PDF com 5', async () => {
    const destroy = jest.fn();
    const getPage = jest.fn(async (_n: number) => ({
      getTextContent: async () => ({ items: [{ str: 'a', hasEOL: true }] }),
    }));
    const pages = [[], [], [], [], []] as Array<Array<{ str: string }>>;
    const importer = fakeImporter({ pages, destroy, getPage });

    await readPdfText(Buffer.from('x'), importer);

    expect(getPage).toHaveBeenCalledTimes(3);
    expect(getPage.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
  });

  it('libera o documento mesmo quando getTextContent lanca', async () => {
    const destroy = jest.fn();
    const getPage = jest.fn(async () => ({
      getTextContent: async () => {
        throw new Error('pagina corrompida');
      },
    }));
    const importer = fakeImporter({ pages: [[]], destroy, getPage });

    await expect(readPdfText(Buffer.from('x'), importer)).rejects.toThrow('pagina corrompida');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('libera a tarefa de carga quando o PDF nao abre (corrompido ou com senha)', async () => {
    const taskDestroy = jest.fn();
    const importer: PdfJsImporter = async () => ({
      getDocument: () => ({ promise: Promise.reject(new Error('PDF invalido')), destroy: taskDestroy }),
    });

    await expect(readPdfText(Buffer.from('x'), importer)).rejects.toThrow('PDF invalido');
    expect(taskDestroy).toHaveBeenCalledTimes(1);
  });
});
