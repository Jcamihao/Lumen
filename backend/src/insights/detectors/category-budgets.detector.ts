import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { formatAmount } from '../format-amount';
import { GeneratedInsight } from '../insight.types';
import { hashSubject } from '../insight-identity';
import { monthTagOf } from './month-tag';

// Orcamento mensal por categoria: avisa ao chegar perto do teto e de novo ao
// estourar. Limitado aos maiores consumos para nao inundar o painel.
const NEAR_PCT = 80;
const OVER_PCT = 100;
const MAX_ALERTS = 3;

type BudgetUse = { categoryId: string; name: string; budget: number; spent: number; pct: number };

function budgetMessage(category: BudgetUse, currency: string): string {
  const pctLabel = Math.floor(category.pct);
  const spentLabel = formatAmount(category.spent, currency);
  const budgetLabel = formatAmount(category.budget, currency);
  if (category.pct >= OVER_PCT) {
    return `${category.name} passou do orcamento deste mes: ${spentLabel} de ${budgetLabel} (${pctLabel}%). Vale rever os proximos gastos ou ajustar o limite.`;
  }
  return `${category.name} ja usou ${pctLabel}% do orcamento deste mes (${spentLabel} de ${budgetLabel}). Faltam ${formatAmount(category.budget - category.spent, currency)} — vale segurar o ritmo.`;
}

/**
 * Categorias que consumiram >= 80% do orcamento mensal definido pelo usuario.
 * Entre 80% e 99% e WARNING; a partir de 100% e CRITICAL (vira notificacao).
 * Um alerta por categoria, dos maiores consumos, no maximo MAX_ALERTS.
 * A chave inclui o mes: no mes seguinte o ciclo recomeca e avisa de novo.
 */
export function detectCategoryBudgets(context: InsightContext): GeneratedInsight[] {
  const spentById = new Map(context.categorySpending.current.map((row) => [row.categoryId, row.total]));
  const currency = context.user.preferredCurrency;
  const monthTag = monthTagOf(context.now);

  return context.categoryBudgets
    .map((category) => {
      const spent = spentById.get(category.categoryId) ?? 0;
      return { ...category, spent, pct: (spent / category.budget) * 100 };
    })
    .filter((category) => category.pct >= NEAR_PCT)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_ALERTS)
    .map((category) => ({
      type: InsightType.FINANCE,
      key: `budget:${hashSubject([category.categoryId, monthTag])}`,
      severity: category.pct >= OVER_PCT ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
      message: budgetMessage(category, currency),
      metadata: {
        category: category.name,
        budget: category.budget,
        spent: category.spent,
        usedPct: Math.floor(category.pct),
      },
    }));
}
