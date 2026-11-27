import { join, dirname } from 'path';
import { createWorker, type PSM, type Worker } from 'tesseract.js';

const LANG_PATH = join(
  dirname(require.resolve('@tesseract.js-data/por/package.json')),
  '4.0.0_best_int',
);

/** Worker do tesseract em português, sem cache em disco; falha de configuração termina o worker. */
export async function createOcrWorker(): Promise<Worker> {
  const worker = await createWorker('por', 1, {
    langPath: LANG_PATH,
    gzip: true,
    // Sem cache em disco: o idioma já vem do pacote local.
    cacheMethod: 'none',
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6' as PSM,
      preserve_interword_spaces: '1',
    });
  } catch (error) {
    // Worker criado mas não configurado não entra no pool: termina para não vazar processo/memória.
    await worker.terminate().catch(() => undefined);
    throw error;
  }
  return worker;
}
