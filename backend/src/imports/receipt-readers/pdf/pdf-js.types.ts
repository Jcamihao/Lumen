type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfPage = { getTextContent(): Promise<{ items: PdfTextItem[] }> };

export type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void> | void;
};
export type PdfJsModule = {
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy?(): Promise<void> | void;
  };
};
export type PdfJsImporter = (specifier: string) => Promise<PdfJsModule>;
