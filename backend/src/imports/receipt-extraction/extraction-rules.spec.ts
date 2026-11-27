import { randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { ReceiptUnreadableError, RECEIPT_TIMEOUT_MESSAGE } from '../receipt-extractor.types';
import { OcrPool } from '../receipt-readers/ocr/ocr-pool';
import { sharp } from '../receipt-readers/image/sharp-loader';
import type { ParsedReceiptText } from '../receipt-text.parser';
import { buildExtraction } from './build-extraction';
import { OPEN_IMAGE_MESSAGE, PDF_SCANNED_MESSAGE } from './extraction-messages';
import { passScore } from './pass-score';
import { ReceiptExtractorService } from './receipt-extractor.service';

const TODAY = new Date(Date.UTC(2026, 10, 16));
const parsedWith = (over: Partial<ParsedReceiptText>) =>
  ({ totalAmount: null, items: [], totalMismatch: 'x', warnings: [], ...over }) as ParsedReceiptText;

describe('regras da extração (sobreviventes de mutação)', () => {
  let service: ReceiptExtractorService;
  let png: Buffer;
  const recognize = jest.fn();
  const image = (buffer: Buffer) => ({ buffer, mimeType: 'image/png', fileName: 'a.png', today: TODAY });
  const pdf = (text: string) => {
    service.readers.readPdfText = async () => text;
    return { buffer: Buffer.from('%PDF'), mimeType: 'application/pdf', fileName: 'a.pdf', today: TODAY };
  };

  beforeAll(async () => {
    png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
  });
  beforeEach(() => {
    recognize.mockReset().mockResolvedValue({ text: 'sem total aqui', confidence: 50 });
    service = new ReceiptExtractorService({} as OcrPool);
    service.readers = { decodeQr: jest.fn(async () => null), readPdfText: jest.fn(), recognize };
  });
  afterEach(() => jest.restoreAllMocks());

  it('PDF com 39 caracteres úteis é digitalizado; com 40 já vira leitura sem total', async () => {
    await expect(service.extract(pdf('a'.repeat(39)))).rejects.toThrow(
      new BadRequestException(PDF_SCANNED_MESSAGE),
    );
    await expect(service.extract(pdf('a'.repeat(40)))).rejects.toBeInstanceOf(ReceiptUnreadableError);
  });

  it('QR recebe prazo de 800 ms', async () => {
    await service.extract(image(png)).catch(() => undefined);
    expect(service.readers.decodeQr).toHaveBeenCalledWith(expect.any(Buffer), 800);
  });

  it('segunda passada lê imagem preparada com 1400 px de largura', async () => {
    await service.extract(image(png)).catch(() => undefined);
    expect(recognize).toHaveBeenCalledTimes(2);
    const widths = await Promise.all(recognize.mock.calls.map(([p]) => sharp(p).metadata().then((m) => m.width)));
    expect(widths).toEqual([300, 1400]);
  });

  it('as duas passadas dividem o mesmo prazo', async () => {
    let clock = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    recognize.mockImplementation(async () => {
      clock += 10_000;
      return { text: 'sem total', confidence: 50 };
    });
    await service.extract(image(png)).catch(() => undefined);
    expect(recognize.mock.calls.map(([, ms]) => ms)).toEqual([30_000, 20_000]);
  });

  it('prazo esgotado exatamente agora recusa sem chamar o OCR', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(5_000_000);
    service.ocrBudgetMs = 0;
    const error = await service.extract(image(png)).catch((e) => e);
    expect(error).toBeInstanceOf(ReceiptUnreadableError);
    expect(error.message).toBe(RECEIPT_TIMEOUT_MESSAGE);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('imagem com cabeçalho válido e dados truncados não abre', async () => {
    const raw = { width: 200, height: 200, channels: 3 as const };
    const noise = await sharp(randomBytes(200 * 200 * 3), { raw }).png().toBuffer();
    const error = await service.extract(image(noise.subarray(0, Math.floor(noise.length * 0.6)))).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(OPEN_IMAGE_MESSAGE);
  });

  it('pontuação da passada pesa total 4, itens 2, sem divergência 2 e avisos -0,1', () => {
    expect(passScore(parsedWith({}))).toBe(0);
    expect(passScore(parsedWith({ totalAmount: 1 as never }))).toBe(4);
    expect(passScore(parsedWith({ items: [{}] as never }))).toBe(2);
    expect(passScore(parsedWith({ totalMismatch: null }))).toBe(2);
    expect(passScore(parsedWith({ warnings: ['a', 'b'] as never }))).toBeCloseTo(-0.2);
  });

  it('extração copia os avisos em vez de compartilhar a lista', () => {
    const parsed = parsedWith({ warnings: ['aviso'] as never });
    const built = buildExtraction(parsed, {
      method: 'OCR', ocrConfidence: 1, qrDetected: false, qrCodeText: null, secondPass: false,
    });
    expect(built.extraction.warnings).toEqual(['aviso']);
    expect(built.extraction.warnings).not.toBe(parsed.warnings);
  });
});
