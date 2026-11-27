import { scoreExpenseCategory, receiptSearchText } from './category-scoring';
import { ExpenseCategoryRef, NormalizedReceiptItem } from './receipt-import.types';
import { normalizeText } from './text-helpers';

function pickCategory(categories: ExpenseCategoryRef[], keywords: string[]): ExpenseCategoryRef | null {
  return (
    categories.find((category) => keywords.some((keyword) => normalizeText(category.name).includes(keyword))) ||
    null
  );
}

function bestScoredCategory(
  categories: ExpenseCategoryRef[],
  merchantName: string | null,
  items: NormalizedReceiptItem[],
): ExpenseCategoryRef | null {
  const scored = categories
    .map((category) => ({ category, score: scoreExpenseCategory(category.name, merchantName, items) }))
    .sort((left, right) => right.score - left.score);
  return scored[0] && scored[0].score > 0 ? scored[0].category : null;
}

function fallbackByKeyword(categories: ExpenseCategoryRef[]): ExpenseCategoryRef | null {
  return (
    pickCategory(categories, ['aliment', 'mercad', 'padar', 'feira', 'horti']) ||
    pickCategory(categories, ['farm', 'saud', 'drog']) ||
    pickCategory(categories, ['morad', 'conta', 'casa', 'utilidade']) ||
    pickCategory(categories, ['transp', 'combust', 'mobilidade'])
  );
}

type TextRule = { text: RegExp; keywords: string[] };

const TEXT_RULES: TextRule[] = [
  { text: /mercad|padar|horti|fruta|arroz|feij|leite|carne|super/, keywords: ['aliment'] },
  { text: /farm|drog|remed|vitamina/, keywords: ['farm', 'saud'] },
  { text: /energia|agua|internet|luz|aluguel|condominio/, keywords: ['morad', 'conta', 'casa'] },
];

/** Sugere a categoria de despesa: pontuacao primeiro, depois palavras do texto da nota. */
export function suggestExpenseCategory(
  categories: ExpenseCategoryRef[],
  merchantName: string | null,
  items: NormalizedReceiptItem[],
): ExpenseCategoryRef | null {
  const best = bestScoredCategory(categories, merchantName, items);
  if (best) return best;
  const byKeyword = fallbackByKeyword(categories);
  const texts = receiptSearchText(merchantName, items);
  const rule = TEXT_RULES.find((candidate) => texts.match(candidate.text));
  if (rule) return pickCategory(categories, rule.keywords) || byKeyword;
  return byKeyword || null;
}
