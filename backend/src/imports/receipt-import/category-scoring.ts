import { NormalizedReceiptItem } from './receipt-import.types';
import { normalizeText } from './text-helpers';

const HINT_TO_CATEGORY_KEYWORDS: Record<string, string[]> = {
  alimentacao: ['aliment', 'mercad', 'super', 'comida'],
  bebidas: ['bebida', 'aliment'],
  hortifruti: ['horti', 'feira', 'aliment'],
  limpeza: ['limpeza', 'casa', 'lar'],
  higiene: ['higiene', 'beleza', 'farm', 'saud'],
  farmacia: ['farm', 'saud'],
  pet: ['pet', 'animal'],
  bebes: ['bebe', 'infantil'],
  casa: ['casa', 'lar', 'utilidade'],
  eletronicos: ['eletron', 'tecnolog', 'informat'],
  vestuario: ['vest', 'roupa', 'moda'],
  servicos: ['servic'],
};

/** Texto unico (sem acento, minusculo) do estabelecimento, dos itens e das dicas. */
export function receiptSearchText(merchantName: string | null, items: NormalizedReceiptItem[]): string {
  return [merchantName || '', ...items.map((item) => item.description), ...items.map((item) => item.categoryHint || '')]
    .map((value) => normalizeText(value))
    .join(' ');
}

function keywordsForProductHint(categoryHint: string | null): string[] {
  const normalizedHint = normalizeText(categoryHint || '');
  if (!normalizedHint) return [];
  const entry = Object.entries(HINT_TO_CATEGORY_KEYWORDS).find(([label]) => normalizedHint.includes(label));
  return entry?.[1] || [];
}

type ScoreRule = { text: RegExp; category: RegExp };

const SCORE_RULES: ScoreRule[] = [
  { text: /farm|remed|vitamina|drog/, category: /farm|saud/ },
  { text: /mercad|super|padar|feira|horti|arroz|leite|carne|fruta/, category: /aliment|mercad|feira|horti/ },
  { text: /detergente|sabao|desinfetante|multiuso/, category: /casa|lar|limpeza|utilidade/ },
  { text: /papel higienico|shampoo|desodorante|sabonete/, category: /higiene|beleza|farm|saud/ },
];

export function scoreExpenseCategory(
  categoryName: string,
  merchantName: string | null,
  items: NormalizedReceiptItem[],
): number {
  const normalizedCategory = normalizeText(categoryName);
  const texts = receiptSearchText(merchantName, items);
  let score = 0;
  if (normalizedCategory && texts.includes(normalizedCategory)) score += 2;
  const hintKeywords = items.flatMap((item) => keywordsForProductHint(item.categoryHint));
  if (hintKeywords.some((keyword) => normalizedCategory.includes(keyword))) score += 4;
  for (const rule of SCORE_RULES) {
    if (texts.match(rule.text) && normalizedCategory.match(rule.category)) score += 3;
  }
  return score;
}
