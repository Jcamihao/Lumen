import { OCR_DIGIT } from './ocr-digits';

export const CPF_REMOVED = 'CPF removido';
// Marcador provisorio: caractere de uso privado (U+E000), que nao aparece em nota fiscal.
export const CPF_MARK = '';
// Rotulo "CPF" em varias grafias: CPF, cpf, C.P.F., ÇPF/CPÉ (acento de OCR), colado em digitos (CPF123...).
const CPF_LABEL_SRC = '(?<![A-Za-zÀ-ÿ])[CÇ]\\.?\\s?P\\.?\\s?[FÉ](?![A-Za-zÀ-ÿ])';
export const CPF_LABEL_RE = new RegExp(CPF_LABEL_SRC, 'gi');
export const CPF_OR_CONSUMER_RE = new RegExp(`(?<![A-Za-zÀ-ÿ])CONSUMIDOR(?![A-Za-zÀ-ÿ])|${CPF_LABEL_SRC}`, 'i');
// CPF solto, sem rotulo: 123.456.789-09, 123 456 789 09, 123.456.789 -09, com O/l/I/S/B no lugar de digito.
export const CPF_SHAPE_RE = new RegExp(
  `(?<![0-9])${OCR_DIGIT}{3}[. ]${OCR_DIGIT}{3}[. ]${OCR_DIGIT}{3}(?: ?[-.] ?| )${OCR_DIGIT}{2}(?![0-9]|,\\d)`,
  'g',
);
// Preserva a chave (44 digitos) e o CNPJ formatado que apareçam depois do rotulo.
export const KEEP_AFTER_LABEL_RE = new RegExp(
  `(?<!${OCR_DIGIT})${OCR_DIGIT}(?: ?${OCR_DIGIT}){43}(?!${OCR_DIGIT})|\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}`,
);
// Resto de um CPF (ate 14 caracteres de digito/separador) logo depois da janela de 30 caracteres.
export const CPF_TAIL_RE = new RegExp(`^[0-9OoIl|SB.\\-]{1,14}(?![0-9OoIl|SB.\\-])`);
export const ELEVEN_DIGITS_RE = /(?<![0-9])[0-9]{11}(?![0-9])/g;
export const CPF_ELEVEN_RE = new RegExp(`^(?:${OCR_DIGIT}[ .\\-]?){10}${OCR_DIGIT}$`);
