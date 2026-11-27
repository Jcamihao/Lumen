import { redactCpf } from './cpf-redaction';
import { MAX_INPUT_CHARS, MAX_REDACTED_CHARS } from './text-limits';

// Escritos como string para o arquivo nao carregar caracteres invisiveis (U+2028 quebraria a regex literal).
const ZERO_WIDTH_RE = new RegExp('[\\u200B-\\u200D\\u2060\\uFEFF]', 'g');
const UNICODE_SPACE_RE = new RegExp('[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]', 'g');
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Limita o tamanho e limpa caracteres invisiveis, espacos unicode e de controle. */
export function normalizeSource(text: string): string {
  return (typeof text === 'string' ? text.slice(0, MAX_INPUT_CHARS) : '')
    .replace(/\r/g, '')
    .replace(ZERO_WIDTH_RE, '') // caracteres de largura zero (PDF/OCR) somem
    .replace(UNICODE_SPACE_RE, ' ') // espacos unicode (NBSP etc.) viram espaco
    .replace(CONTROL_CHARS_RE, ' ');
}

export function splitLines(source: string): string[] {
  return source.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
}

/** Texto guardado: sem CPF, linhas vazias repetidas colapsadas, ate 500 caracteres. */
export function redactedExcerpt(source: string): string {
  const collapsed: string[] = [];
  for (const line of redactCpf(source).split('\n').map((l) => l.trimEnd())) {
    const previousIsBlank = collapsed.length === 0 || collapsed[collapsed.length - 1] === '';
    if (line === '' && previousIsBlank) continue;
    collapsed.push(line);
  }
  return collapsed.join('\n').slice(0, MAX_REDACTED_CHARS);
}
