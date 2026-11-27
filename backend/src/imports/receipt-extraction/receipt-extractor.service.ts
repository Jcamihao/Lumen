import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ReceiptBusyError,
  ReceiptExtraction,
  ReceiptExtractInput,
  ReceiptUnreadableError,
} from '../receipt-extractor.types';
import { OcrPool } from '../receipt-readers/ocr/ocr-pool';
import { decodeQr } from '../receipt-readers/qr/qr-decoder';
import { readPdfText } from '../receipt-readers/pdf/pdf-text.reader';
import { extractReceiptFromImage } from './image-extraction';
import { extractReceiptFromPdf } from './pdf-extraction';
import { OCR_BUDGET_MS, MAX_CONCURRENT_READS } from './extraction-limits';
import { HEIC_MESSAGE } from './extraction-messages';
import { ReceiptReaders } from './extraction-readers.type';

@Injectable()
export class ReceiptExtractorService {
  private readonly logger = new Logger(ReceiptExtractorService.name);
  private activeReads = 0;

  // Leitores ficam em um campo para os testes trocarem por simulados.
  readers: ReceiptReaders;

  // Prazo do OCR (as duas passadas). Em produção fica em 30 s; só os testes com OCR real
  // o aumentam, para não falharem quando a máquina está saturada por outros testes.
  ocrBudgetMs = OCR_BUDGET_MS;

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
      const result = await this.readReceipt(input);
      this.logRead(result, started);
      return result;
    } finally {
      this.activeReads--;
    }
  }

  private async readReceipt(input: ReceiptExtractInput): Promise<ReceiptExtraction> {
    const result = await this.dispatchByMimeType(input);

    // O total é obrigatório no banco: sem total não se inventa valor.
    if (result.totalAmount === null) {
      throw new ReceiptUnreadableError();
    }
    return result;
  }

  private dispatchByMimeType(input: ReceiptExtractInput): Promise<ReceiptExtraction> {
    if (input.mimeType === 'image/heic') {
      throw new BadRequestException(HEIC_MESSAGE);
    }
    if (input.mimeType === 'application/pdf') {
      return extractReceiptFromPdf(input, this.readers);
    }
    return extractReceiptFromImage(input, this.readers, this.ocrBudgetMs);
  }

  private logRead(result: ReceiptExtraction, started: number) {
    this.logger.log(
      `Nota lida: método=${result.extraction.method}, segunda passada=${result.extraction.secondPass}, ` +
        `${Date.now() - started} ms, ${result.items.length} itens, ${result.extraction.warnings.length} avisos`,
    );
  }
}
