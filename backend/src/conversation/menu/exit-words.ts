import { normalize } from '../parsers/normalize';

/** Sobe ao menu inicial quando nao ha rascunho; com rascunho, cancela e mostra o menu. */
const MENU_WORDS = new Set(['voltar', 'sair', 'menu', 'inicio', 'comecar', 'start']);
/** Cancela o rascunho; sem nada aberto responde "Nada para cancelar." e mostra o menu. */
const CANCEL_WORDS = new Set(['cancelar', 'cancela', 'parar', 'desistir', 'deixa pra la', 'deixa quieto', 'esquece', 'chega']);

export type ExitKind = 'MENU' | 'CANCEL';

/** Frase inteira de saida (sem acento, sem caixa, sem pontuacao final). "nao", "ok" e "sim" nunca saem. */
export function exitKindOf(text: string): ExitKind | null {
  const words = normalize(text);
  if (MENU_WORDS.has(words)) return 'MENU';
  if (CANCEL_WORDS.has(words)) return 'CANCEL';
  return null;
}
