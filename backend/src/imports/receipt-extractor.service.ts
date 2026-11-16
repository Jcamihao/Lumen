import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ReceiptBusyError,
  ReceiptExtraction,
  ReceiptExtractInput,
  ReceiptUnreadableError,
  RECEIPT_TIMEOUT_MESSAGE,
} from './receipt-extractor.types';
import {
  decodeQr,
  OcrPool,
  OcrTimeoutError,
  RECEIPT_MAX_PIXELS,
  readPdfText,
  sharp,
  SharpPipeline,
} from './receipt-readers';
import {
  extractAccessKeyFromQr,
  ParsedReceiptText,
  parseReceiptText,
  sanitizeQrUrl,
} from './receipt-text.parser';

const MAX_CONCURRENT_READS = 2;
const QR_DEADLINE_MS = 800;
const OCR_BUDGET_MS = 30_000;
const PDF_MIN_TEXT_CHARS = 40;
// Limite padrão do próprio sharp, usado só para ler o cabeçalho antes da checagem de megapixels.
const SHARP_HEADER_PIXEL_LIMIT = 268_402_689;

const HEIC_MESSAGE =
  'Formato HEIC não é lido. Envie a foto em JPG ou PNG, ou tire um print da nota.';
const PDF_SCANNED_MESSAGE =
  'Este PDF é uma imagem digitalizada e não pode ser lido. Envie a foto da nota em JPG ou PNG.';
const OPEN_IMAGE_MESSAGE = 'Não consegui abrir esta imagem. Envie a foto em JPG ou PNG.';
const IMAGE_TOO_LARGE_MESSAGE = 'Imagem muito grande. Envie uma foto com até 25 megapixels.';

export type ReceiptReaders = {
  decodeQr: (png: Buffer, deadlineMs: number) => Promise<string | null>;
  readPdfText: (buffer: Buffer) => Promise<string>;
  recognize: (png: Buffer, timeoutMs: number) => Promise<{ text: string; confidence: number }>;
};

type OcrPass = { parsed: ParsedReceiptText; confidence: number };

// Pontuação da segunda passada: o maior vence; empate fica com a primeira.
function passScore(parsed: ParsedReceiptText) {
  return (
    (parsed.totalAmount !== null ? 4 : 0) +
    (parsed.items.length > 0 ? 2 : 0) +
    (parsed.totalMismatch === null ? 2 : 0) -
    parsed.warnings.length * 0.1
  );
}

@Injectable()
export class ReceiptExtractorService {
  private readonly logger = new Logger(ReceiptExtractorService.name);
  private activeReads = 0;

  // Leitores ficam em um campo para os testes trocarem por simulados.
  readers: ReceiptReaders;

  constructor(ocrPool: OcrPool) {
    this.readers = {
      decodeQr,
      readPdfText: (buffer) => readPdfText(buffer),
      recognize: (png, timeoutMs) => ocrPool.recognize(png, timeoutMs),
    };
  }

  /** Lê a nota localmente. Sem rede, sem arquivo temporário, sem log do texto lido. */
  async extract(input: ReceiptExtractInput): Promise<ReceiptExtraction> {
    // Sem fila: a terceira leitura simultânea é recusada na hora.
    if (this.activeReads >= MAX_CONCURRENT_READS) {
      throw new ReceiptBusyError();
    }

    this.activeReads++;
    const started = Date.now();
    try {
      if (input.mimeType === 'image/heic') {
        throw new BadRequestException(HEIC_MESSAGE);
      }

      const result =
        input.mimeType === 'application/pdf'
          ? await this.extractFromPdf(input)
          : await this.extractFromImage(input);

      // O total é obrigatório no banco: sem total não se inventa valor.
      if (result.totalAmount === null) {
        throw new ReceiptUnreadableError();
      }

      this.logger.log(
        `Nota lida: método=${result.extraction.method}, segunda passada=${result.extraction.secondPass}, ` +
          `${Date.now() - started} ms, ${result.items.length} itens, ${result.extraction.warnings.length} avisos`,
      );
      return result;
    } finally {
      this.activeReads--;
    }
  }

  private async extractFromPdf(input: ReceiptExtractInput): Promise<ReceiptExtraction> {
    let text: string;
    try {
      text = await this.readers.readPdfText(input.buffer);
    } catch {
      throw new ReceiptUnreadableError();
    }

    const meaningful = text.replace(/[^\p{L}\p{N}]/gu, '');
    if (meaningful.length < PDF_MIN_TEXT_CHARS) {
      throw new BadRequestException(PDF_SCANNED_MESSAGE);
    }

    const parsed = parseReceiptText(text, { today: input.today });
    return this.build(parsed, {
      method: 'PDF_TEXT',
      ocrConfidence: null,
      qrDetected: false,
      qrCodeText: null,
      secondPass: false,
    });
  }

  private async extractFromImage(input: ReceiptExtractInput): Promise<ReceiptExtraction> {
    await this.ensureReadableImage(input.buffer);

    // Foto de celular vem deitada: .rotate() sem argumento aplica a orientação do EXIF.
    const rotated = await this.toPng(input.buffer, (pipeline) => pipeline.rotate());

    const qrRaw = await this.readers.decodeQr(rotated, QR_DEADLINE_MS);
    const qrAccessKey = qrRaw ? extractAccessKeyFromQr(qrRaw) : null;
    const qrCodeText = qrRaw ? sanitizeQrUrl(qrRaw) : null;

    const deadline = Date.now() + OCR_BUDGET_MS;
    const first = await this.runOcr(rotated, qrAccessKey, input.today, deadline);

    let chosen = first;
    let secondPass = false;
    if (first.parsed.totalAmount === null || first.parsed.totalMismatch !== null) {
      const prepared = await this.toPng(rotated, (pipeline) =>
        pipeline
          .flatten({ background: '#ffffff' })
          .greyscale()
          .normalise()
          .resize({ width: 1400 })
          .sharpen(),
      );
      const second = await this.runOcr(prepared, qrAccessKey, input.today, deadline);
      secondPass = true;
      if (passScore(second.parsed) > passScore(first.parsed)) {
        chosen = second;
      }
    }

    return this.build(chosen.parsed, {
      method: 'OCR',
      ocrConfidence: chosen.confidence,
      qrDetected: qrRaw !== null,
      qrCodeText,
      secondPass,
    });
  }

  private async ensureReadableImage(buffer: Buffer) {
    let width: number;
    let height: number;
    try {
      const metadata = await sharp(buffer, { limitInputPixels: SHARP_HEADER_PIXEL_LIMIT }).metadata();
      width = metadata.width ?? 0;
      height = metadata.height ?? 0;
    } catch {
      throw new BadRequestException(OPEN_IMAGE_MESSAGE);
    }

    if (width <= 0 || height <= 0) {
      throw new BadRequestException(OPEN_IMAGE_MESSAGE);
    }
    // Checagem antes de decodificar: uma imagem enorme não chega a ocupar memória.
    if (width * height > RECEIPT_MAX_PIXELS) {
      throw new BadRequestException(IMAGE_TOO_LARGE_MESSAGE);
    }
  }

  private async toPng(
    source: Buffer,
    adjust: (pipeline: SharpPipeline) => SharpPipeline,
  ): Promise<Buffer> {
    try {
      return await adjust(sharp(source, { limitInputPixels: RECEIPT_MAX_PIXELS })).png().toBuffer();
    } catch {
      throw new BadRequestException(OPEN_IMAGE_MESSAGE);
    }
  }

  private async runOcr(
    png: Buffer,
    qrAccessKey: string | null,
    today: Date,
    deadline: number,
  ): Promise<OcrPass> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ReceiptUnreadableError(RECEIPT_TIMEOUT_MESSAGE);
    }

    let result: { text: string; confidence: number };
    try {
      result = await this.readers.recognize(png, remaining);
    } catch (error) {
      if (error instanceof OcrTimeoutError) {
        throw new ReceiptUnreadableError(RECEIPT_TIMEOUT_MESSAGE);
      }
      throw new ReceiptUnreadableError();
    }

    return {
      parsed: parseReceiptText(result.text, { today, qrAccessKey }),
      confidence: result.confidence / 100,
    };
  }

  private build(
    parsed: ParsedReceiptText,
    meta: {
      method: 'PDF_TEXT' | 'OCR';
      ocrConfidence: number | null;
      qrDetected: boolean;
      qrCodeText: string | null;
      secondPass: boolean;
    },
  ): ReceiptExtraction {
    return {
      ...parsed,
      extraction: {
        method: meta.method,
        ocrConfidence: meta.ocrConfidence,
        warnings: [...parsed.warnings],
        qrDetected: meta.qrDetected,
        secondPass: meta.secondPass,
      },
      qrCodeText: meta.qrCodeText,
    };
  }
}
