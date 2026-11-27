export class OcrTimeoutError extends Error {
  constructor() {
    super('OCR excedeu o tempo limite');
    this.name = 'OcrTimeoutError';
  }
}
