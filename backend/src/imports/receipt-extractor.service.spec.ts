import { BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReceiptExtractorService } from './receipt-extractor.service';
import {
  ReceiptBusyError,
  ReceiptUnreadableError,
  RECEIPT_TIMEOUT_MESSAGE,
} from './receipt-extractor.types';
import { OcrPool, OcrTimeoutError, sharp } from './receipt-readers';
import { RECEIPT_WARNINGS } from './receipt-text.parser';

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures', 'receipts');
const truth = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'truth.json'), 'utf8'));
const n1 = truth[0];
const n2 = truth[1];
const TODAY = new Date(Date.UTC(2026, 10, 16));

jest.setTimeout(120_000);

const money = (value: number) => value.toFixed(2).replace('.', ',');

// Texto de nota no formato do parser (linhas do gabarito). Opções geram variantes para as regras.
function noteText(
  t: typeof n1,
  options: { omitTotal?: boolean; omitItems?: boolean; totalValue?: number } = {},
) {
  const cnpj = t.cnpj;
  const cnpjFormatted = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
  const lines = [t.merchant, `CNPJ: ${cnpjFormatted}`, 'DANFE NFC-e'];
  if (!options.omitItems) {
    t.items.forEach((item: any, index: number) => {
      lines.push(
        `${String(index + 1).padStart(3, '0')} ${item.desc} ${String(item.qty).replace('.', ',')} ${item.un} ${money(item.unit)} ${money(item.total)}`,
      );
    });
  }
  if (!options.omitTotal) {
    lines.push(`VALOR TOTAL R$ ${money(options.totalValue ?? t.total)}`);
  }
  lines.push(`NFC-e n. ${t.nf} Emissao ${t.date} 10:30:00`);
  lines.push('CHAVE DE ACESSO');
  lines.push(t.key.match(/.{1,4}/g)!.join(' '));
  lines.push('CONSUMIDOR NAO IDENTIFICADO');
  return lines.join('\n');
}

function captureError(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error('esperava erro e nao veio');
    },
    (error) => error,
  );
}

describe('ReceiptExtractorService (leitores simulados)', () => {
  let blankPng: Buffer;
  let service: ReceiptExtractorService;

  beforeAll(async () => {
    blankPng = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    service = new ReceiptExtractorService({} as OcrPool);
    service.readers = {
      decodeQr: jest.fn(async () => null),
      readPdfText: jest.fn(async () => noteText(n2)),
      recognize: jest.fn(async () => ({ text: noteText(n1), confidence: 90 })),
    };
  });

  const pdfInput = () => ({
    buffer: Buffer.from('%PDF-1.4 fake'),
    mimeType: 'application/pdf',
    fileName: 'nota.pdf',
    today: TODAY,
  });
  const imageInput = (buffer = blankPng, mimeType = 'image/png') => ({
    buffer,
    mimeType,
    fileName: 'nota.png',
    today: TODAY,
  });

  describe('vaga de leitura (limite de 2 simultaneas)', () => {
    it('terceira leitura simultanea responde RECEIPT_BUSY (429) sem esperar', async () => {
      const resolvers: Array<() => void> = [];
      service.readers.readPdfText = jest.fn(
        () => new Promise<string>((resolve) => resolvers.push(() => resolve(noteText(n2)))),
      );

      const first = service.extract(pdfInput());
      const second = service.extract(pdfInput());
      const busy = await captureError(service.extract(pdfInput()));

      expect(busy).toBeInstanceOf(ReceiptBusyError);
      expect(busy.getStatus()).toBe(429);
      expect(busy.getResponse()).toMatchObject({ code: 'RECEIPT_BUSY' });

      resolvers.forEach((resolve) => resolve());
      await Promise.all([first, second]);
    });

    it('a vaga volta depois de sucesso', async () => {
      await service.extract(pdfInput());
      for (let i = 0; i < 3; i++) {
        await expect(service.extract(pdfInput())).resolves.toBeDefined();
      }
    });

    it('a vaga volta depois de erro', async () => {
      service.readers.readPdfText = jest.fn(async () => {
        throw new Error('pdf corrompido');
      });
      await expect(service.extract(pdfInput())).rejects.toBeInstanceOf(ReceiptUnreadableError);

      service.readers.readPdfText = jest.fn(async () => noteText(n2));
      for (let i = 0; i < 3; i++) {
        await expect(service.extract(pdfInput())).resolves.toBeDefined();
      }
    });

    it('a vaga volta depois de timeout do OCR', async () => {
      service.readers.recognize = jest.fn(async () => {
        throw new OcrTimeoutError();
      });
      await expect(service.extract(imageInput())).rejects.toBeInstanceOf(ReceiptUnreadableError);

      service.readers.recognize = jest.fn(async () => ({ text: noteText(n1), confidence: 90 }));
      for (let i = 0; i < 3; i++) {
        await expect(service.extract(imageInput())).resolves.toBeDefined();
      }
    });
  });

  describe('recusas com mensagem clara', () => {
    it('HEIC responde 400 com a mensagem exata', async () => {
      const error = await captureError(service.extract(imageInput(blankPng, 'image/heic')));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'Formato HEIC não é lido. Envie a foto em JPG ou PNG, ou tire um print da nota.',
      );
    });

    it('PDF sem texto (10 caracteres) responde 400 com a mensagem exata', async () => {
      service.readers.readPdfText = jest.fn(async () => 'ABCDE FGHIJ');
      const error = await captureError(service.extract(pdfInput()));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'Este PDF é uma imagem digitalizada e não pode ser lido. Envie a foto da nota em JPG ou PNG.',
      );
    });

    it('imagem com mais de 25 megapixels responde 400 e o OCR nem e chamado', async () => {
      const huge = await sharp({
        create: { width: 6000, height: 5000, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer();

      const error = await captureError(service.extract(imageInput(huge)));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Imagem muito grande. Envie uma foto com até 25 megapixels.');
      expect(service.readers.recognize).not.toHaveBeenCalled();
      expect(service.readers.decodeQr).not.toHaveBeenCalled();
    });

    it('arquivo que nao e imagem (assinatura PNG com lixo) responde 400 "Não consegui abrir"', async () => {
      const fake = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('bytes aleatorios que nao formam imagem'),
      ]);

      const error = await captureError(service.extract(imageInput(fake)));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/^Não consegui abrir/);
    });
  });

  describe('fluxo de passadas', () => {
    it('1a leitura sem total chama a 2a (pre-processamento) e escolhe a de maior pontuacao', async () => {
      service.readers.recognize = jest
        .fn()
        .mockResolvedValueOnce({ text: noteText(n1, { omitTotal: true }), confidence: 40 })
        .mockResolvedValueOnce({ text: noteText(n1), confidence: 80 });

      const result = await service.extract(imageInput());

      expect(service.readers.recognize).toHaveBeenCalledTimes(2);
      expect(result.totalAmount).toBe(n1.total);
      expect(result.extraction.secondPass).toBe(true);
      expect(result.extraction.ocrConfidence).toBeCloseTo(0.8);
    });

    it('1a leitura boa nao chama a 2a (secondPass false)', async () => {
      const result = await service.extract(imageInput());

      expect(service.readers.recognize).toHaveBeenCalledTimes(1);
      expect(result.extraction.secondPass).toBe(false);
    });

    it('empate de pontuacao fica com a 1a leitura', async () => {
      // Divergencia de soma dispara a 2a; as duas leituras pontuam igual, entao vale a 1a (confianca 50).
      const divergent = noteText(n1, { totalValue: n1.total + 1 });
      service.readers.recognize = jest
        .fn()
        .mockResolvedValueOnce({ text: divergent, confidence: 50 })
        .mockResolvedValueOnce({ text: divergent, confidence: 90 });

      const result = await service.extract(imageInput());

      expect(result.extraction.secondPass).toBe(true);
      expect(result.extraction.ocrConfidence).toBeCloseTo(0.5);
    });
  });

  describe('regras de resultado', () => {
    it('total nulo depois de tudo responde 422 RECEIPT_UNREADABLE, mesmo havendo itens', async () => {
      service.readers.recognize = jest.fn(async () => ({
        text: noteText(n1, { omitTotal: true }),
        confidence: 60,
      }));

      const error = await captureError(service.extract(imageInput()));

      expect(error).toBeInstanceOf(ReceiptUnreadableError);
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({ code: 'RECEIPT_UNREADABLE' });
    });

    it('total lido sem itens e aceito com o aviso W_NO_ITEMS', async () => {
      service.readers.recognize = jest.fn(async () => ({
        text: noteText(n1, { omitItems: true }),
        confidence: 80,
      }));

      const result = await service.extract(imageInput());

      expect(result.totalAmount).toBe(n1.total);
      expect(result.items).toEqual([]);
      expect(result.extraction.warnings).toContain(RECEIPT_WARNINGS.W_NO_ITEMS);
    });

    it('timeout do OCR responde 422 com a mensagem de tempo', async () => {
      service.readers.recognize = jest.fn(async () => {
        throw new OcrTimeoutError();
      });

      const error = await captureError(service.extract(imageInput()));

      expect(error).toBeInstanceOf(ReceiptUnreadableError);
      expect(error.getResponse()).toMatchObject({ message: RECEIPT_TIMEOUT_MESSAGE });
    });

    it('PDF com texto: method PDF_TEXT, ocrConfidence null, sem QR nem OCR', async () => {
      const result = await service.extract(pdfInput());

      expect(result.extraction.method).toBe('PDF_TEXT');
      expect(result.extraction.ocrConfidence).toBeNull();
      expect(result.totalAmount).toBe(n2.total);
      expect(service.readers.decodeQr).not.toHaveBeenCalled();
      expect(service.readers.recognize).not.toHaveBeenCalled();
    });

    it('chave do QR vence a do OCR e avisa W_KEY_CONFLICT', async () => {
      const qrKey = n1.key;
      const ocrKey = n2.key;
      service.readers.decodeQr = jest.fn(
        async () => `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${qrKey}|2|1|1|abc123`,
      );
      service.readers.recognize = jest.fn(async () => ({
        text: noteText({ ...n1, key: ocrKey }),
        confidence: 90,
      }));

      const result = await service.extract(imageInput());

      expect(result.accessKey).toBe(qrKey);
      expect(result.accessKeyValid).toBe(true);
      expect(result.extraction.warnings).toContain(RECEIPT_WARNINGS.W_KEY_CONFLICT);
      expect(result.qrCodeText).toBe(`https://www.fazenda.pr.gov.br/nfce/qrcode?p=${qrKey}`);
    });

    it('foto de celular e girada pelo EXIF antes do QR e do OCR', async () => {
      const landscape = await sharp({
        create: { width: 300, height: 150, channels: 3, background: '#ffffff' },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();
      let seen: Buffer | null = null;
      service.readers.decodeQr = jest.fn(async (png: Buffer) => {
        seen = png;
        return null;
      });

      await service.extract(imageInput(landscape, 'image/jpeg'));

      const meta = await sharp(seen!).metadata();
      expect(meta.height).toBeGreaterThan(meta.width);
    });
  });

  describe('registro e privacidade', () => {
    it('nenhum log recebe pedaco do texto lido', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      try {
        await service.extract(imageInput());
        const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');

        expect(logged).not.toContain(n1.merchant);
        expect(logged).not.toContain('ARROZ');
        expect(logged).not.toContain(n1.cnpj);
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});

describe('ReceiptExtractorService (bibliotecas reais, nota sintetica)', () => {
  const pool = new OcrPool();
  let service: ReceiptExtractorService;

  beforeAll(() => {
    service = new ReceiptExtractorService(pool);
  });

  afterAll(() => pool.onModuleDestroy());

  it('nota-n1.png: total, data, CNPJ e chave iguais ao gabarito, sem criar arquivo em disco', async () => {
    const before = fs.readdirSync(os.tmpdir()).sort();
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    try {
      const result = await service.extract({
        buffer: fs.readFileSync(path.join(FIXTURES, 'nota-n1.png')),
        mimeType: 'image/png',
        fileName: 'nota-n1.png',
        today: TODAY,
      });
      const logged = logSpy.mock.calls.flat().join(' ');

      expect(result.totalAmount).toBe(n1.total);
      expect(result.purchaseDate?.toISOString().slice(0, 10)).toBe('2026-02-23');
      expect(result.cnpj).toBe(n1.cnpj);
      expect(result.accessKey).toBe(n1.key);
      expect(result.extraction.method).toBe('OCR');
      expect(result.extraction.qrDetected).toBe(true);
      expect(logged).not.toContain('ARROZ');
    } finally {
      logSpy.mockRestore();
    }

    const after = fs.readdirSync(os.tmpdir()).sort();
    expect(after).toEqual(before);
  });

  it('nota-n1-jpeg.jpg: ou acerta o total, ou tem aviso, ou e recusada (sem erro silencioso)', async () => {
    const buffer = fs.readFileSync(path.join(FIXTURES, 'nota-n1-jpeg.jpg'));
    try {
      const result = await service.extract({
        buffer,
        mimeType: 'image/jpeg',
        fileName: 'nota-n1-jpeg.jpg',
        today: TODAY,
      });
      if (result.totalAmount !== n1.total) {
        expect(result.extraction.warnings.length).toBeGreaterThan(0);
      }
    } catch (error) {
      expect(error).toBeInstanceOf(ReceiptUnreadableError);
    }
  });
});
