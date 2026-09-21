import { Transaction } from '../models/domain.models';

export type SpendingSlice = {
  key: string;
  name: string;
  color: string;
  icon: string;
  amount: number;
  /** Fracao exata (0-100), usada para desenhar o arco. */
  percent: number;
  /** Inteiro para exibir; a soma das fatias fecha em 100. */
  percentLabel: number;
  isOther: boolean;
};

export type SpendingBreakdown = {
  total: number;
  slices: SpendingSlice[];
};

export const SPENDING_MAX_SLICES = 6;

const UNCATEGORIZED_KEY = '__none__';
const OTHERS_KEY = '__others__';
const UNCATEGORIZED_COLOR = 'color-mix(in srgb, var(--text-medium) 55%, transparent)';
const OTHERS_COLOR = 'var(--text-medium)';
const FALLBACK_COLORS = ['#006cd2', '#f18f01', '#0f9d7a', '#7c5cff', '#ef4444', '#0ea5e9'];

/**
 * Agrupa as DESPESAS por categoria (transferencia nao e gasto). Mantem as
 * maiores categorias e junta o resto em "Outros", para o grafico continuar
 * legivel mesmo com muitas categorias.
 */
export function buildSpendingBreakdown(
  transactions: Transaction[],
  maxSlices = SPENDING_MAX_SLICES,
): SpendingBreakdown {
  const groups = new Map<string, { name: string; color?: string; icon?: string; amount: number }>();

  for (const transaction of transactions) {
    if (transaction.type !== 'EXPENSE') {
      continue;
    }

    const key = transaction.category?.id ?? UNCATEGORIZED_KEY;
    const group = groups.get(key) ?? {
      name: transaction.category?.name ?? 'Sem categoria',
      color: transaction.category?.color,
      icon: transaction.category?.icon,
      amount: 0,
    };
    group.amount += transaction.amount;
    groups.set(key, group);
  }

  const total = [...groups.values()].reduce((sum, group) => sum + group.amount, 0);

  if (total <= 0) {
    return { total: 0, slices: [] };
  }

  const sorted = [...groups.entries()]
    .filter(([, group]) => group.amount > 0)
    .sort((left, right) => right[1].amount - left[1].amount);

  const visible = sorted.length > maxSlices ? sorted.slice(0, maxSlices - 1) : sorted;
  const rest = sorted.length > maxSlices ? sorted.slice(maxSlices - 1) : [];

  const slices: SpendingSlice[] = visible.map(([key, group], index) => ({
    key,
    name: group.name,
    color:
      key === UNCATEGORIZED_KEY
        ? UNCATEGORIZED_COLOR
        : group.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    icon: key === UNCATEGORIZED_KEY ? 'help' : group.icon || 'sell',
    amount: group.amount,
    percent: (group.amount / total) * 100,
    percentLabel: 0,
    isOther: false,
  }));

  if (rest.length) {
    const amount = rest.reduce((sum, [, group]) => sum + group.amount, 0);
    slices.push({
      key: OTHERS_KEY,
      name: 'Outros',
      color: OTHERS_COLOR,
      icon: 'more_horiz',
      amount,
      percent: (amount / total) * 100,
      percentLabel: 0,
      isOther: true,
    });
  }

  applyLargestRemainderRounding(slices);

  return { total, slices };
}

/** Arredonda as porcentagens para inteiros somando exatamente 100. */
function applyLargestRemainderRounding(slices: SpendingSlice[]) {
  const floors = slices.map((slice) => Math.floor(slice.percent));
  let missing = 100 - floors.reduce((sum, value) => sum + value, 0);

  const byRemainder = slices
    .map((slice, index) => ({ index, remainder: slice.percent - floors[index] }))
    .sort((left, right) => right.remainder - left.remainder);

  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    floors[index] += 1;
    missing -= 1;
  }

  slices.forEach((slice, index) => {
    slice.percentLabel = floors[index];
  });
}
