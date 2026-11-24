import { cleanCardTerm } from './credit-limit';
import { normalizeWord } from './parsers/normalize';

/*
 * Criar e renomear cartao pela conversa (contrato 9b-3, secao 7). Funcoes puras: sem banco, sem Nest.
 * A gravacao e do CreditCardsService (mesmo caminho da API); aqui ficam o texto e a leitura do comando.
 */

/** Mesmo limite do DTO da API (create e update): 1 a 40 caracteres, depois de aparar. */
export const CARD_NAME_MIN = 1;
export const CARD_NAME_MAX = 40;

export const CARD_WRITE_REPLIES = {
  createUnavailable: 'Criar cartão pela conversa ainda não está disponível. Crie o cartão na tela de cartões do app.',
  renameNeedsTerm: 'Diga qual cartão renomear, ex.: renomear cartão Principal para Nubank.',
  renameNeedsName: 'Diga o novo nome, ex.: renomear cartão Principal para Nubank.',
  nameLength: `O nome do cartão deve ter de ${CARD_NAME_MIN} a ${CARD_NAME_MAX} caracteres.`,
  sameName: 'O novo nome é igual ao atual. Nada foi alterado.',
  nameTaken: 'Já existe um cartão com este nome. Nada foi alterado.',
  cardArchived: 'Cartão arquivado não pode ser renomeado. Nada foi alterado.',
  notFound: (term: string, names: string[]): string =>
    `Não achei cartão com "${term}". Cartões: ${names.join(', ')}. Refaça com o nome completo.`,
  ambiguous: (term: string, names: string[]): string =>
    `Mais de um cartão bate com "${term}": ${names.join(', ')}. Refaça com o nome completo.`,
  cardGone: 'Cartão não encontrado. Nada foi alterado. Confira o nome em "meus cartões".',
  renameSaveFailed: 'Não consegui renomear o cartão. O rascunho foi mantido; tente confirmar de novo.',
  renameSaveFailedRestoreLost: 'Não consegui renomear o cartão e o rascunho se perdeu. Refaça o pedido.',
  renameRejected: 'Não foi possível renomear o cartão. Confira os dados e refaça o pedido.',
};

export type CardRenameParse = { ok: true; term: string; newName: string } | { ok: false; text: string };

/**
 * "renomear cartao Principal para Nubank" -> termo "Principal" e novo nome "Nubank". O separador e o primeiro "para"
 * (nome que tenha "para" dentro fica para a duvida de produto). Sem "para" ou sem nome novo: recusa sem rascunho.
 */
export function parseCardRename(body: string): CardRenameParse {
  const trimmed = body.trim();
  const tokens = trimmed === '' ? [] : trimmed.split(/\s+/);
  const at = tokens.findIndex((token) => normalizeWord(token) === 'para');
  if (at === -1) return { ok: false, text: CARD_WRITE_REPLIES.renameNeedsName };
  const term = cleanCardTerm(tokens.slice(0, at).join(' '));
  const newName = tokens.slice(at + 1).join(' ').trim();
  if (term === '') return { ok: false, text: CARD_WRITE_REPLIES.renameNeedsTerm };
  if (newName === '') return { ok: false, text: CARD_WRITE_REPLIES.renameNeedsName };
  if (newName.length < CARD_NAME_MIN || newName.length > CARD_NAME_MAX) return { ok: false, text: CARD_WRITE_REPLIES.nameLength };
  return { ok: true, term, newName };
}

/** Confere se o nome novo bate com outro cartao ativo, sem diferenciar maiuscula (mesma regra da API). */
export function nameTakenBy(cards: Array<{ id: string; name: string }>, name: string, exceptId: string): boolean {
  const wanted = name.toLowerCase();
  return cards.some((card) => card.id !== exceptId && card.name.toLowerCase() === wanted);
}

export function cardRenameDraftText(input: { from: string; to: string }): string {
  return `Renomear o cartão ${input.from} para ${input.to}.`;
}

export function cardRenamedText(input: { from: string; to: string }): string {
  return `Cartão ${input.from} renomeado para ${input.to}.`;
}
