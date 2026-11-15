/** Minusculas, sem acento, sem pontuacao final e com espacos colapsados. Usar so para comparar texto. */
export function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[?!.,;:]+$/g, '');
}

export function normalize(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map(normalizeWord)
    .filter((word) => word.length > 0)
    .join(' ');
}
