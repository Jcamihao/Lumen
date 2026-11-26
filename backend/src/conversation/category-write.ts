import { TransactionType } from '@prisma/client';
import { CategoryChangeDraft } from './conversation.types';
import { normalize } from './parsers/normalize';

/** Resultado desconhecido: a gravacao pode ter ocorrido. Nao repetir; conferir a tela. */
export class CategoryWriteUncertainError extends Error {
  constructor() {
    super('Resultado da alteracao da categoria desconhecido.');
  }
}

export function isCategoryChangeDraft(draft: unknown): draft is CategoryChangeDraft {
  return (draft as { kind?: string } | null)?.kind === 'CATEGORY_CHANGE';
}

/** Criar, editar e excluir categoria por conversa (menu guiado, fatia 2). Funcoes puras: sem banco, sem Nest. */

export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 40;
/** Quantas categorias a lista de editar/excluir mostra (as demais se acham pelo app). */
export const CATEGORY_PICK_MAX = 15;

const CATEGORY_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#14b8a6'];

/** Cor automatica: gira pela paleta conforme quantas categorias o usuario ja tem. */
export function nextCategoryColor(existingCount: number): string {
  return CATEGORY_COLORS[existingCount % CATEGORY_COLORS.length];
}

export const CATEGORY_REPLIES = {
  askName: 'Qual o nome da nova categoria? Ex.: Pets',
  askType: 'É de despesa ou de receita? Responda 1 (despesa) ou 2 (receita).',
  nameShort: 'O nome precisa ter pelo menos 2 letras.',
  nameLong: 'O nome passou de 40 letras. Use um menor.',
  nameTaken: 'Você já tem uma categoria com este nome.',
  pickHeader: 'Qual categoria? Responda com o número:',
  pickMoreInApp: 'Tem mais categorias; as outras ficam no app.',
  askNewName: (current: string) => `Qual o novo nome para "${current}"? Ex.: Animais`,
  none: 'Você ainda não tem categorias. Crie a primeira em Menu → Finanças → Categorias → Criar categoria.',
  gone: 'Não encontrei mais essa categoria.',
  sameName: 'Esse já é o nome dela. Diga outro nome ou responda cancelar.',
  deleteWarning: 'Os lançamentos dela ficam sem categoria. Isto não dá para desfazer. Responda apagar para excluir ou cancelar.',
  sharedWarning: 'Ela é compartilhada: o lançamento da outra pessoa também fica sem categoria.',
  changedMeanwhile: 'Essa categoria mudou desde que você escolheu. Refaça o pedido.',
  createSaveFailed: 'Não consegui salvar. Nada foi gravado; tente de novo.',
  createSaveFailedRestoreLost: 'Não consegui confirmar se a categoria foi salva. Confira em Finanças antes de tentar de novo.',
} as const;

export function categoryTypeLabel(type: TransactionType | 'EXPENSE' | 'INCOME'): string {
  return type === 'INCOME' ? 'receita' : 'despesa';
}

export type CategoryNameCheck = { ok: true; name: string } | { ok: false; text: string };

/** Nome limpo (espacos colapsados) com 2 a 40 letras. */
export function checkCategoryName(raw: string): CategoryNameCheck {
  const name = raw.trim().replace(/\s+/g, ' ');
  const length = Array.from(name).length;
  if (length < CATEGORY_NAME_MIN) return { ok: false, text: CATEGORY_REPLIES.nameShort };
  if (length > CATEGORY_NAME_MAX) return { ok: false, text: CATEGORY_REPLIES.nameLong };
  return { ok: true, name };
}

const EXPENSE_WORDS = new Set(['1', 'despesa', 'despesas', 'gasto', 'gastos', 'saida', 'saidas']);
const INCOME_WORDS = new Set(['2', 'receita', 'receitas', 'entrada', 'entradas', 'ganho', 'ganhos']);

export function parseCategoryType(answer: string): 'EXPENSE' | 'INCOME' | null {
  const word = normalize(answer);
  if (EXPENSE_WORDS.has(word)) return 'EXPENSE';
  if (INCOME_WORDS.has(word)) return 'INCOME';
  return null;
}

/** "Pets", "receita Salario" ou vazio: tipo opcional na frente do nome. */
export function parseCategoryCreateBody(body: string): { name: string | null; type: 'EXPENSE' | 'INCOME' | null } {
  const words = body.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return { name: null, type: null };
  const first = normalize(words[0]);
  const type = first === 'despesa' || first === 'receita' ? parseCategoryType(first) : null;
  if (type !== null && words.length > 1) return { name: words.slice(1).join(' '), type };
  return { name: words.join(' '), type: null };
}

/** Mesmo nome (sem acento nem caixa) entre categorias do mesmo tipo. */
export function categoryNameTaken(
  categories: Array<{ id: string; name: string; type: string }>,
  name: string,
  type: string,
  exceptId = '',
): boolean {
  const wanted = normalize(name);
  return categories.some((category) => category.id !== exceptId && category.type === type && normalize(category.name) === wanted);
}

/** Linha da lista de escolha: "1. Mercado (despesa)". */
export function categoryPickLine(index: number, category: { name: string; type: string }): string {
  return `${index + 1}. ${category.name} (${categoryTypeLabel(category.type as 'EXPENSE' | 'INCOME')})`;
}

export function categoryCreateDraftText(input: { name: string | null; type: 'EXPENSE' | 'INCOME' | null }): string {
  const name = input.name ?? 'a informar';
  const type = input.type === null ? 'a informar' : categoryTypeLabel(input.type);
  return `Criar categoria: ${name} (${type}). Responda confirmar para salvar ou cancelar.`;
}
