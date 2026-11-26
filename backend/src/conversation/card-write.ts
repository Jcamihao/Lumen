import { cleanCardTerm } from './credit-limit';
import { normalize, normalizeWord } from './parsers/normalize';

/*
 * Criar e renomear cartao pela conversa (contrato 9b-3 secao 7 e 9b-3b). Funcoes puras: sem banco, sem Nest.
 * A gravacao e do CreditCardsService (mesmo caminho da API); aqui ficam o texto e a leitura do comando.
 */

/** Mesmo limite do DTO da API (create e update): 1 a 40 caracteres, depois de aparar. */
export const CARD_NAME_MIN = 1;
export const CARD_NAME_MAX = 40;

export const CARD_WRITE_REPLIES = {
  createNeedsName: 'Diga o nome do cartão, ex.: criar cartão Nubank fecha dia 10.',
  askName: 'Qual o nome do novo cartão? Ex.: Nubank',
  pickHeader: 'Qual cartão? Responda com o número:',
  askNewName: (current: string): string => `Qual o novo nome para o cartão ${current}? Ex.: Roxinho`,
  alreadyClear: 'Esse cartão já está sem limite. Escolha outro número ou responda cancelar.',
  createUnknownWord: 'Não entendi. Use: criar cartão Nubank fecha dia 10 vence dia 17 (o vencimento é opcional).',
  createBadDay: (label: 'fechamento' | 'vencimento'): string => `O dia de ${label} deve ser de 1 a 31. Nada foi criado.`,
  createLimit: (max: number): string => `Você já tem ${max} cartões ativos (limite técnico). Nada foi criado.`,
  createNameTaken: 'Já existe um cartão com este nome. Nada foi criado.',
  askClosingDay: (name: string): string => `Qual o dia de fechamento do ${name} (1 a 31)?`,
  closingDayInvalid: 'Responda com um dia de 1 a 31.',
  createSaveFailed: 'Não consegui criar o cartão. O rascunho foi mantido; tente confirmar de novo.',
  createSaveFailedRestoreLost: 'Não consegui criar o cartão e o rascunho se perdeu. Refaça o pedido.',
  createRejected: 'Não foi possível criar o cartão. Confira os dados e refaça o pedido.',
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

/** Palavras que abrem o dia de fechamento e o de vencimento na frase de criar cartao. */
const CLOSING_WORDS = new Set(['fecha', 'fechamento']);
const DUE_WORDS = new Set(['vence', 'vencimento']);

export type CardCreateParse =
  | { ok: true; name: string; closingDay: number | null; dueDay: number | null }
  | { ok: false; text: string };

/**
 * "Nubank fecha dia 10 vence dia 17" -> nome, fechamento 10 e vencimento 17. O dia "dia" e opcional. Sem fechamento na
 * frase, o motor pergunta. Dia fora de 1 a 31 ou palavra desconhecida recusa sem rascunho (nada e gravado).
 */
export function parseCardCreate(body: string): CardCreateParse {
  const trimmed = body.trim();
  const tokens = trimmed === '' ? [] : trimmed.split(/\s+/);
  const isKeyword = (token: string) => CLOSING_WORDS.has(normalizeWord(token)) || DUE_WORDS.has(normalizeWord(token));
  const first = tokens.findIndex(isKeyword);
  const name = (first === -1 ? tokens : tokens.slice(0, first)).join(' ');
  if (name === '') return { ok: false, text: CARD_WRITE_REPLIES.createNeedsName };
  if (name.length < CARD_NAME_MIN || name.length > CARD_NAME_MAX) return { ok: false, text: CARD_WRITE_REPLIES.nameLength };

  let closingDay: number | null = null;
  let dueDay: number | null = null;
  const seen = new Set<string>();
  let i = first === -1 ? tokens.length : first;
  while (i < tokens.length) {
    const word = normalizeWord(tokens[i]);
    const isClosing = CLOSING_WORDS.has(word);
    if (!isClosing && !DUE_WORDS.has(word)) return { ok: false, text: CARD_WRITE_REPLIES.createUnknownWord };
    if (seen.has(word)) return { ok: false, text: CARD_WRITE_REPLIES.createUnknownWord };
    seen.add(word);
    const label = isClosing ? 'fechamento' : 'vencimento';
    i += 1;
    if (i < tokens.length && normalizeWord(tokens[i]) === 'dia') i += 1;
    const raw = tokens[i];
    const day = raw !== undefined && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (!(day >= 1 && day <= 31)) return { ok: false, text: CARD_WRITE_REPLIES.createBadDay(label) };
    if (isClosing) closingDay = day;
    else dueDay = day;
    i += 1;
  }
  return { ok: true, name, closingDay, dueDay };
}

/** Resposta da pergunta do fechamento: so o numero do dia (aceita "10" e "dia 10"). Null = invalida. */
export function parseClosingDayAnswer(value: string): number | null {
  const match = /^(?:dia )?(\d{1,2})$/.exec(normalize(value));
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

/**
 * Confere se o nome novo bate com outro cartao ativo: sem diferenciar maiuscula (regra da API) E sem acento/pontuacao final
 * (regra da busca do chat). Sem isso, "Roxinho" e "Róxinho" viram dois cartoes que o chat nao consegue distinguir (igualdade
 * normalizada empata e a busca responde "mais de um cartao").
 */
export function nameTakenBy(cards: Array<{ id: string; name: string }>, name: string, exceptId: string): boolean {
  const wanted = name.toLowerCase();
  const wantedKey = normalize(name);
  return cards.some(
    (card) => card.id !== exceptId && (card.name.toLowerCase() === wanted || (wantedKey !== '' && normalize(card.name) === wantedKey)),
  );
}

export function cardPickLine(index: number, card: { name: string; isDefault?: boolean }): string {
  return `${index + 1}. ${card.name}${card.isDefault ? ' (padrão)' : ''}`;
}

export function cardCreateDraftText(input: { name: string | null; closingDay: number | null; dueDay: number | null }): string {
  const closing = input.closingDay === null ? 'a informar' : `dia ${input.closingDay}`;
  const due = input.dueDay === null ? 'sem vencimento' : `dia ${input.dueDay}`;
  return `Criar o cartão ${input.name ?? 'a informar'}. Fecha: ${closing}. Vence: ${due}. Não será o cartão padrão.`;
}

export function cardCreatedText(input: { name: string; closingDay: number; dueDay: number | null }): string {
  const due = input.dueDay === null ? '' : `, vence dia ${input.dueDay}`;
  return `Cartão ${input.name} criado, fecha dia ${input.closingDay}${due}.`;
}

export function cardRenameDraftText(input: { from: string; to: string }): string {
  return `Renomear o cartão ${input.from} para ${input.to}.`;
}

export function cardRenamedText(input: { from: string; to: string }): string {
  return `Cartão ${input.from} renomeado para ${input.to}.`;
}
