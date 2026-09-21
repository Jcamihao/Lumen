import { FinanceCategory, Transaction } from '../models/domain.models';

/** Mesmos limiares do backend (insights.service): 80% avisa, 100% estourou. */
export const BUDGET_NEAR_PERCENT = 80;
export const BUDGET_OVER_PERCENT = 100;

export type BudgetStatus = 'none' | 'ok' | 'near' | 'over';

export type BudgetRow = {
  id: string;
  name: string;
  color: string;
  icon?: string;
  budget: number | null;
  spent: number;
  /** Inteiro para exibir (arredonda para baixo, como o alerta do Selah). */
  percentLabel: number;
  /** 0-100, para a largura da barra. */
  barPercent: number;
  status: BudgetStatus;
  /** Quanto falta (positivo) ou quanto passou (negativo); null sem orcamento. */
  remaining: number | null;
};

/**
 * Uma linha por categoria de DESPESA: quanto foi gasto no periodo das
 * transacoes recebidas e, se houver teto, o quanto dele ja foi usado. Quem tem
 * orcamento vem primeiro, do mais consumido ao menos; o resto por gasto.
 */
export function buildBudgetRows(
  categories: FinanceCategory[],
  transactions: Transaction[],
): BudgetRow[] {
  const spentById = new Map<string, number>();

  for (const transaction of transactions) {
    const id = transaction.category?.id;
    if (transaction.type !== 'EXPENSE' || !id) {
      continue;
    }
    spentById.set(id, (spentById.get(id) ?? 0) + transaction.amount);
  }

  const rows = categories
    .filter((category) => category.type === 'EXPENSE')
    .map((category): BudgetRow => {
      const spent = spentById.get(category.id) ?? 0;
      const budget =
        typeof category.monthlyBudget === 'number' && category.monthlyBudget > 0
          ? category.monthlyBudget
          : null;
      const percent = budget ? (spent / budget) * 100 : 0;

      return {
        id: category.id,
        name: category.name,
        color: category.color,
        icon: category.icon,
        budget,
        spent,
        percentLabel: Math.floor(percent),
        barPercent: Math.min(percent, 100),
        status: !budget
          ? 'none'
          : percent >= BUDGET_OVER_PERCENT
            ? 'over'
            : percent >= BUDGET_NEAR_PERCENT
              ? 'near'
              : 'ok',
        remaining: budget ? budget - spent : null,
      };
    });

  return rows.sort((a, b) => {
    if ((a.budget !== null) !== (b.budget !== null)) {
      return a.budget !== null ? -1 : 1;
    }
    if (a.budget !== null && b.budget !== null) {
      return b.percentLabel - a.percentLabel || a.name.localeCompare(b.name);
    }
    return b.spent - a.spent || a.name.localeCompare(b.name);
  });
}
