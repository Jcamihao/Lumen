import { SENSITIVE_STEMS, TONE_TEXTS, ToneKind, ToneMoment } from './tone.texts';

/** Assunto do texto: decide o tom base (receita alegre, guardar celebrando, parcelado atento, despesa neutra). */
export type ToneSubject = 'RECEITA' | 'DESPESA' | 'GUARDAR' | 'PARCELADO';

const TONE_BY_SUBJECT: Record<ToneSubject, ToneKind> = {
  RECEITA: 'ALEGRE',
  DESPESA: 'NEUTRO',
  GUARDAR: 'CELEBRANDO',
  PARCELADO: 'ATENTO',
};

function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

/** Verdadeiro quando algum texto (descricao ou categoria) tem palavra sensivel. */
export function hasSensitiveWord(texts: readonly string[]): boolean {
  return texts.some((text) => words(text).some((word) => SENSITIVE_STEMS.some((stem) => word.startsWith(stem))));
}

/** Tom final: sensivel vira NEUTRO; senao, o tom do assunto. */
export function toneKindFor(subject: ToneSubject, texts: readonly string[]): ToneKind {
  return hasSensitiveWord(texts) ? 'NEUTRO' : TONE_BY_SUBJECT[subject];
}

/** FNV-1a de 32 bits: mesma entrada, mesmo número, em qualquer processo. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Variante escolhida pelo hash da semente (messageId do rascunho). */
export function variantIndex(seed: string, size: number): number {
  return fnv1a(seed) % size;
}

export function toneText(input: {
  kind: ToneKind;
  moment: ToneMoment;
  seed: string;
  values: Record<string, string>;
}): string {
  const variants = TONE_TEXTS[input.kind][input.moment];
  const template = variants[variantIndex(input.seed, variants.length)];
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = input.values[key];
    if (value === undefined) {
      throw new Error(`placeholder sem valor: ${key}`);
    }
    return value;
  });
}
