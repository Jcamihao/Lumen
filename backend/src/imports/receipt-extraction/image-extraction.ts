import { ReceiptExtraction, ReceiptExtractInput } from '../receipt-extractor.types';
import { extractAccessKeyFromQr, ParsedReceiptText, sanitizeQrUrl } from '../receipt-text.parser';
import { buildExtraction } from './build-extraction';
import { QR_DEADLINE_MS } from './extraction-limits';
import { ReceiptReaders } from './extraction-readers.type';
import { ensureReadableImage } from './image-guard';
import { prepareForSecondPass, rotateToPng } from './image-conversion';
import { OcrContext, OcrPass, runOcr } from './ocr-pass';
import { passScore } from './pass-score';

type OcrPasses = { chosen: OcrPass; secondPass: boolean };

/** Nota em foto: lê o QR e roda o OCR, com segunda passada se a primeira não achou o total. */
export async function extractReceiptFromImage(
  input: ReceiptExtractInput,
  readers: ReceiptReaders,
  ocrBudgetMs: number,
): Promise<ReceiptExtraction> {
  await ensureReadableImage(input.buffer);
  const rotated = await rotateToPng(input.buffer);

  const qrRaw = await readers.decodeQr(rotated, QR_DEADLINE_MS);
  const qrAccessKey = qrRaw ? extractAccessKeyFromQr(qrRaw) : null;
  const qrCodeText = qrRaw ? sanitizeQrUrl(qrRaw) : null;

  // O prazo do OCR começa depois da leitura do QR.
  const context: OcrContext = {
    qrAccessKey,
    today: input.today,
    deadline: Date.now() + ocrBudgetMs,
  };
  const passes = await runOcrPasses(readers, rotated, context);

  return buildExtraction(passes.chosen.parsed, {
    method: 'OCR',
    ocrConfidence: passes.chosen.confidence,
    qrDetected: qrRaw !== null,
    qrCodeText,
    secondPass: passes.secondPass,
  });
}

async function runOcrPasses(
  readers: ReceiptReaders,
  rotated: Buffer,
  context: OcrContext,
): Promise<OcrPasses> {
  const first = await runOcr(readers, rotated, context);
  if (!needsSecondPass(first.parsed)) {
    return { chosen: first, secondPass: false };
  }

  const prepared = await prepareForSecondPass(rotated);
  const second = await runOcr(readers, prepared, context);
  const chosen = passScore(second.parsed) > passScore(first.parsed) ? second : first;
  return { chosen, secondPass: true };
}

function needsSecondPass(parsed: ParsedReceiptText): boolean {
  return parsed.totalAmount === null || parsed.totalMismatch !== null;
}
