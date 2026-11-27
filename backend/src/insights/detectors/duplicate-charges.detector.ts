import { InsightSeverity, InsightType } from '@prisma/client';
import { differenceInCalendarDays } from 'date-fns';
import { InsightContext } from '../context/insight-context.types';
import { formatAmount } from '../format-amount';
import { ChargeOccurrence, GeneratedInsight } from '../insight.types';
import { hashSubject } from '../insight-identity';
import { groupChargesByFingerprint } from './charge-grouping';

/** Cobrancas iguais dentro dessa janela sao tratadas como possivel duplicata. */
const DUPLICATE_WINDOW_DAYS = 3;

type Duplicate = { description: string; amount: number; occurrences: number; lastDate: string };

/** Primeira repeticao dentro da janela, ou null se o grupo nao repete a tempo. */
function findDuplicateIn(group: ChargeOccurrence[]): Duplicate | null {
  const ordered = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
  let cluster: ChargeOccurrence[] = [];

  for (const charge of ordered) {
    const previous = cluster[cluster.length - 1];
    if (previous && differenceInCalendarDays(charge.date, previous.date) > DUPLICATE_WINDOW_DAYS) {
      cluster = [];
    }
    cluster.push(charge);
    if (cluster.length >= 2) {
      return {
        description: charge.description,
        amount: charge.amount,
        occurrences: cluster.length,
        lastDate: charge.date.toISOString(),
      };
    }
  }
  return null;
}

function duplicatesMessage(duplicates: Duplicate[], currency: string): string {
  const first = duplicates[0];
  const amount = formatAmount(first.amount, currency);
  if (duplicates.length === 1) {
    return `Encontrei uma cobranca repetida: ${first.description} de ${amount} aparece ${first.occurrences} vezes em ate ${DUPLICATE_WINDOW_DAYS} dias. Vale conferir se nao foi cobrada em duplicidade.`;
  }
  return `Encontrei ${duplicates.length} cobrancas repetidas em ate ${DUPLICATE_WINDOW_DAYS} dias, comecando por ${first.description} de ${amount}. Vale conferir se alguma foi cobrada em duplicidade.`;
}

/**
 * Cobranca repetida: mesma descricao e mesmo valor dentro de poucos dias.
 * Costuma ser cobranca em duplicidade ou lancamento importado duas vezes.
 */
export function detectDuplicateCharges(context: InsightContext): GeneratedInsight | null {
  const duplicates = groupChargesByFingerprint(context.recentExpenses)
    .map(findDuplicateIn)
    .filter((entry): entry is Duplicate => entry !== null);
  if (duplicates.length === 0) return null;

  return {
    type: InsightType.FINANCE,
    key: `duplicate_charges:${hashSubject(duplicates.map((entry) => `${entry.description}:${entry.amount}`))}`,
    severity: InsightSeverity.WARNING,
    message: duplicatesMessage(duplicates, context.user.preferredCurrency),
    metadata: { duplicates, windowDays: DUPLICATE_WINDOW_DAYS },
  };
}
