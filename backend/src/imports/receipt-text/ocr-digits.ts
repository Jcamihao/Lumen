// Caracteres que o OCR confunde com digito (usado so em campos numericos).
export const OCR_DIGIT = '[0-9OoIl|SB]';

export function fixNumericOcr(raw: string): string {
  return (raw ?? '').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
}
