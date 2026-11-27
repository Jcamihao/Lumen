import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { CategoryTotal, GeneratedInsight } from '../insight.types';
import { hashSubject } from '../insight-identity';
import { monthTagOf } from './month-tag';

// Mudanca de peso de uma categoria nos gastos do mes vs. mes anterior. Compara
// a PARTICIPACAO (% do total gasto), nao o valor: o mes corrente esta pela
// metade e valor absoluto sempre pareceria "queda".
const MIN_TOTAL = 200;
const MIN_TRANSACTIONS = 5;
const MIN_SHARE_PCT = 20;
const MIN_DELTA_PTS = 10;
const WARNING_DELTA_PTS = 20;

type Shift = { row: CategoryTotal; share: number; previousShare: number; delta: number };

const sum = (rows: CategoryTotal[], field: 'total' | 'count'): number =>
  rows.reduce((acc, row) => acc + row[field], 0);

function findBiggestShift(current: CategoryTotal[], previous: CategoryTotal[], totals: [number, number]): Shift | null {
  const [currentTotal, previousTotal] = totals;
  const previousShareById = new Map(previous.map((row) => [row.categoryId, (row.total / previousTotal) * 100]));
  let best: Shift | null = null;

  for (const row of current) {
    if (!row.categoryId) continue;
    const share = (row.total / currentTotal) * 100;
    const previousShare = previousShareById.get(row.categoryId) ?? 0;
    const delta = share - previousShare;
    if (share >= MIN_SHARE_PCT && delta >= MIN_DELTA_PTS && (!best || delta > best.delta)) {
      best = { row, share, previousShare, delta };
    }
  }
  return best;
}

/**
 * Categoria que ganhou muito peso nos gastos do mes em relacao ao mes
 * anterior. Compara participacao (%), exige volume minimo nos dois meses e
 * ignora gasto sem categoria (nao ha o que apontar). Escolhe so a maior alta.
 */
export function detectCategoryShift(context: InsightContext): GeneratedInsight | null {
  const { current, previous, previousMonthLabel } = context.categorySpending;
  const currentTotal = sum(current, 'total');
  const previousTotal = sum(previous, 'total');
  if (currentTotal < MIN_TOTAL || previousTotal < MIN_TOTAL || sum(current, 'count') < MIN_TRANSACTIONS) return null;

  const best = findBiggestShift(current, previous, [currentTotal, previousTotal]);
  if (!best) return null;

  const shareLabel = Math.round(best.share);
  const previousShareLabel = Math.round(best.previousShare);
  return {
    type: InsightType.FINANCE,
    key: `category_shift:${hashSubject([best.row.categoryId as string, monthTagOf(context.now)])}`,
    severity: best.delta >= WARNING_DELTA_PTS ? InsightSeverity.WARNING : InsightSeverity.INFO,
    message: `${best.row.name} ja pesa ${shareLabel}% dos seus gastos deste mes, contra ${previousShareLabel}% em ${previousMonthLabel} — a maior alta entre as categorias. Vale olhar o que puxou isso.`,
    metadata: {
      category: best.row.name,
      sharePct: shareLabel,
      previousSharePct: previousShareLabel,
      previousMonth: previousMonthLabel,
    },
  };
}
