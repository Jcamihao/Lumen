import { normalize } from '../parsers/normalize';

/** Sobe ao menu inicial quando nao ha rascunho; com rascunho, cancela e mostra o menu. */
const MENU_WORDS = new Set(['voltar', 'sair', 'menu', 'inicio', 'comecar', 'start']);
/** Cancela o rascunho; sem nada aberto responde "Nada para cancelar." e mostra o menu. */
const CANCEL_WORDS = new Set(['cancelar', 'cancela', 'parar', 'desistir', 'deixa pra la', 'deixa quieto', 'esquece', 'chega']);

const GREETING_PATTERNS: RegExp[] = [
  /^o+i+e*$/,
  /^o+l+a+$/,
  /^o+p+a+$/,
  /^e+ a+i+$/,
  /^e+a+e+$/,
  /^s+a+l+v+e+$/,
  /^h+e+y+$/,
  /^h+i+$/,
  /^h+e+l+o+$/,
  /^fala+$/,
  /^bom dia$/,
  /^boa (tarde|noite)$/,
  /^bo+m+ di+a+$/,
  /^(oi+|ola+|opa+|e+ a+i+|fala+) (tudo|td) (bem|bom|certo)$/,
  /^(oi+|ola+|opa+) (bom dia|boa tarde|boa noite)$/,
  /^(bom dia|boa tarde|boa noite) (tudo|td) (bem|bom|certo)$/,
];

/** Saudacao inteira ("oi", "bom dia", "oiieee"): sem rascunho abre o menu. Frase maior nao vale. */
export function isGreeting(text: string): boolean {
  const words = normalize(text);
  return GREETING_PATTERNS.some((pattern) => pattern.test(words));
}

export type ExitKind = 'MENU' | 'CANCEL';

/** Frase inteira de saida (sem acento, sem caixa, sem pontuacao final). "nao", "ok" e "sim" nunca saem. */
export function exitKindOf(text: string): ExitKind | null {
  const words = normalize(text);
  if (MENU_WORDS.has(words)) return 'MENU';
  if (CANCEL_WORDS.has(words)) return 'CANCEL';
  return null;
}
