import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { dirname, join } from 'path';
import type { Sharp } from 'sharp';
import type SharpConstructor from 'sharp';
import { createWorker, type PSM, type Worker } from 'tesseract.js';

// O pacote sharp só traz tipos ESM (default); o require do CJS entrega o mesmo construtor.
export const sharp = require('sharp') as typeof SharpConstructor;
export type SharpPipeline = Sharp;

// Leitores finos: cada função faz uma coisa (QR, texto de PDF, OCR) e não decide
// nada sobre a nota. A regra de negócio fica em receipt-extractor.service.ts.

export const RECEIPT_MAX_PIXELS = 25_000_000;

type JsQrOptions = { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' };
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: JsQrOptions,
) => { data: string } | null;
// jsqr não tem tipos embutidos na versão usada; o tipo mínimo acima cobre só o que lemos.
const jsQR = require('jsqr') as JsQrFn;

const QR_WIDTHS: Array<number | null> = [null, 900, 1400, 600];

/**
 * Procura um QR code na imagem PNG. Tenta a largura original e três redimensionamentos,
 * mas nunca começa uma tentativa depois de `deadlineMs` ms desde o início.
 * Não lança: erro de imagem vira `null` (sem QR legível).
 */
export async function decodeQr(png: Buffer, deadlineMs = 800): Promise<string | null> {
  const start = Date.now();

  for (const width of QR_WIDTHS) {
    if (Date.now() - start >= deadlineMs) {
      return null;
    }

    try {
      let pipeline = sharp(png, { limitInputPixels: RECEIPT_MAX_PIXELS }).flatten({
        background: '#ffffff',
      });
      if (width) {
        pipeline = pipeline.resize({ width });
      }

      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (code) {
        return code.data;
      }
    } catch {
      return null;
    }
  }

  return null;
}

// --- PDF com texto ---------------------------------------------------------

const MAX_PDF_PAGES = 3;

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfPage = { getTextContent(): Promise<{ items: PdfTextItem[] }> };
type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void> | void;
};
export type PdfJsModule = {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocument> };
};
export type PdfJsImporter = (specifier: string) => Promise<PdfJsModule>;

// O backend compila para CommonJS, e o TypeScript trocaria import() por require(),
// o que quebra o pdfjs-dist (ESM puro). Por isso o import() vai dentro de new Function.
const dynamicImport = new Function('specifier', 'return import(specifier)') as PdfJsImporter;

/**
 * Extrai o texto das primeiras 3 páginas de um PDF com camada de texto.
 * Itens com `hasEOL` quebram linha; páginas são separadas por quebra de linha.
 * O documento é liberado (`destroy`) sempre, mesmo se a leitura falhar.
 */
export async function readPdfText(buffer: Buffer, importer: PdfJsImporter = dynamicImport): Promise<string> {
  const pdfjs = await importer('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);

    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
          .join(''),
      );
    }

    return pages.join('\n');
  } finally {
    try {
      await doc.destroy();
    } catch {
      // Liberar o documento não pode mascarar o resultado nem o erro da leitura.
    }
  }
}

// --- OCR ---------------------------------------------------------------------

const OCR_MAX_WORKERS = 2;
const LANG_PATH = join(
  dirname(require.resolve('@tesseract.js-data/por/package.json')),
  '4.0.0_best_int',
);

export class OcrTimeoutError extends Error {
  constructor() {
    super('OCR excedeu o tempo limite');
    this.name = 'OcrTimeoutError';
  }
}

/**
 * Pool de até 2 workers do tesseract (português, dado local, sem cache em disco).
 * Um worker que estoura o tempo é terminado e sai do pool; o pool recria sob demanda.
 */
@Injectable()
export class OcrPool implements OnModuleDestroy {
  private readonly idle: Worker[] = [];
  private readonly all = new Set<Worker>();
  private readonly waiters: Array<() => void> = [];
  private creating = 0;

  get size() {
    return this.all.size;
  }

  async recognize(png: Buffer, timeoutMs: number): Promise<{ text: string; confidence: number }> {
    let timedOut = false;
    let worker: Worker | null = null;
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new OcrTimeoutError());
      }, timeoutMs);
    });

    const work = (async () => {
      const acquired = await this.acquire();
      if (timedOut) {
        // O prazo acabou enquanto esperávamos worker: devolve o worker ao pool.
        this.release(acquired);
        throw new OcrTimeoutError();
      }
      worker = acquired;
      const { data } = await acquired.recognize(png);
      return { text: data.text, confidence: data.confidence };
    })();

    try {
      const result = await Promise.race([work, timeout]);
      this.release(worker!);
      return result;
    } catch (error) {
      if (worker) {
        await this.discard(worker);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy() {
    const workers = [...this.all];
    this.all.clear();
    this.idle.length = 0;
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
  }

  private async acquire(): Promise<Worker> {
    for (;;) {
      const idle = this.idle.pop();
      if (idle) {
        return idle;
      }
      if (this.all.size + this.creating < OCR_MAX_WORKERS) {
        return this.spawn();
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private async spawn(): Promise<Worker> {
    this.creating++;
    try {
      const worker = await createWorker('por', 1, {
        langPath: LANG_PATH,
        gzip: true,
        // Sem cache em disco: o idioma já vem do pacote local.
        cacheMethod: 'none',
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as PSM,
        preserve_interword_spaces: '1',
      });
      this.all.add(worker);
      return worker;
    } catch (error) {
      this.wake();
      throw error;
    } finally {
      this.creating--;
    }
  }

  private release(worker: Worker) {
    this.idle.push(worker);
    this.wake();
  }

  private async discard(worker: Worker) {
    this.all.delete(worker);
    const index = this.idle.indexOf(worker);
    if (index >= 0) {
      this.idle.splice(index, 1);
    }
    await worker.terminate().catch(() => undefined);
    this.wake();
  }

  private wake() {
    this.waiters.shift()?.();
  }
}
