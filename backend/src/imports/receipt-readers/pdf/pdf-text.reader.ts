import { dynamicImport } from './pdf-js-importer';
import type { PdfDocument, PdfJsImporter } from './pdf-js.types';

const MAX_PDF_PAGES = 3;

/**
 * Extrai o texto das primeiras 3 páginas de um PDF com camada de texto.
 * Itens com `hasEOL` quebram linha; páginas são separadas por quebra de linha.
 * O documento é liberado (`destroy`) sempre, mesmo se a leitura falhar.
 */
export async function readPdfText(
  buffer: Buffer,
  importer: PdfJsImporter = dynamicImport,
): Promise<string> {
  const pdfjs = await importer('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const doc = await openDocument(task);

  try {
    return await readFirstPages(doc);
  } finally {
    await releaseDocument(doc);
  }
}

async function openDocument(task: {
  promise: Promise<PdfDocument>;
  destroy?(): Promise<void> | void;
}): Promise<PdfDocument> {
  try {
    return await task.promise;
  } catch (error) {
    // PDF corrompido ou com senha: libera a tarefa de carga, senão ela fica retida.
    await destroyLoadingTask(task);
    throw error;
  }
}

async function destroyLoadingTask(task: { destroy?(): Promise<void> | void }) {
  try {
    await task.destroy?.();
  } catch {
    // O erro original é o que importa.
  }
}

async function readFirstPages(doc: PdfDocument): Promise<string> {
  const pages: string[] = [];
  const count = Math.min(doc.numPages, MAX_PDF_PAGES);

  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join(''));
  }

  return pages.join('\n');
}

async function releaseDocument(doc: PdfDocument) {
  try {
    await doc.destroy();
  } catch {
    // Liberar o documento não pode mascarar o resultado nem o erro da leitura.
  }
}
