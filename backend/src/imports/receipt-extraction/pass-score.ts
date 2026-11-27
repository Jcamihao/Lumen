import type { ParsedReceiptText } from '../receipt-text.parser';

// Pontuação da segunda passada: o maior vence; empate fica com a primeira.
export function passScore(parsed: ParsedReceiptText) {
  return (
    (parsed.totalAmount !== null ? 4 : 0) +
    (parsed.items.length > 0 ? 2 : 0) +
    (parsed.totalMismatch === null ? 2 : 0) -
    parsed.warnings.length * 0.1
  );
}
