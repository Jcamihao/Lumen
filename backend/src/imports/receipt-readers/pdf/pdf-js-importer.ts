import type { PdfJsImporter } from './pdf-js.types';

// O backend compila para CommonJS, e o TypeScript trocaria import() por require(),
// o que quebra o pdfjs-dist (ESM puro). Por isso o import() vai dentro de new Function.
export const dynamicImport = new Function('specifier', 'return import(specifier)') as PdfJsImporter;
