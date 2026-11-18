// Script manual (fora do jest): lê as fixtures reais de nota e imprime método, total, itens, avisos e tempo.
// Uso: npx ts-node test/receipt-extractor.smoke.ts
import * as fs from 'fs';
import * as path from 'path';
import { ReceiptExtractorService } from '../src/imports/receipt-extractor.service';
import { OcrPool } from '../src/imports/receipt-readers';

const DIR = path.join(__dirname, 'fixtures', 'receipts');
const FILES: Array<[string, string]> = [
  ['nota-n1.png', 'image/png'],
  ['nota-n1-jpeg.jpg', 'image/jpeg'],
  ['nota-n2-texto.pdf', 'application/pdf'],
  ['nota-n1-digitalizada.pdf', 'application/pdf'],
];

async function main() {
  const pool = new OcrPool();
  const service = new ReceiptExtractorService(pool);
  const today = new Date();

  try {
    for (const [fileName, mimeType] of FILES) {
      const started = Date.now();
      try {
        const result = await service.extract({
          buffer: fs.readFileSync(path.join(DIR, fileName)),
          mimeType,
          fileName,
          today,
        });
        const itemsSum = result.itemsSum === null ? '-' : result.itemsSum.toFixed(2);
        console.log(
          `${fileName}: método=${result.extraction.method} total=${result.totalAmount} ` +
            `itens=${result.items.length} somaItens=${itemsSum} chaveValida=${result.accessKeyValid} ` +
            `confiança=${result.extraction.ocrConfidence ?? '-'} segundaPassada=${result.extraction.secondPass} ` +
            `avisos=[${result.extraction.warnings.join(' | ') || 'nenhum'}] ${Date.now() - started} ms`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`${fileName}: RECUSADA ${message} ${Date.now() - started} ms`);
      }
    }
  } finally {
    await pool.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
