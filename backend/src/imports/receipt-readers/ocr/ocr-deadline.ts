import { OcrTimeoutError } from './ocr-timeout.error';

export type OcrDeadline = {
  promise: Promise<never>;
  hasPassed: () => boolean;
  clear: () => void;
};

export function startOcrDeadline(timeoutMs: number): OcrDeadline {
  let passed = false;
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      passed = true;
      reject(new OcrTimeoutError());
    }, timeoutMs);
  });

  return { promise, hasPassed: () => passed, clear: () => clearTimeout(timer) };
}
