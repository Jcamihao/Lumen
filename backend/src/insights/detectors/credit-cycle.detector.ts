import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightContext } from '../context/insight-context.types';
import { formatAmount } from '../format-amount';
import { GeneratedInsight } from '../insight.types';

// Mesmos limiares do orcamento por categoria e do CreditCycleService: 80%
// avisa, 100% estourou. Duplicado de proposito — se um mudar, o outro precisa acompanhar.
const NEAR_PCT = 80;
const OVER_PCT = 100;

/**
 * Teto de credito do ciclo aberto agora (v. CreditCycleService): mesmos
 * limiares do orcamento por categoria. So dispara com teto definido; um
 * ciclo sem teto (usuario nunca configurou) fica em silencio.
 */
export function detectCreditCycle(context: InsightContext): GeneratedInsight | null {
  const { ceiling, spent, dueDay, closingDate } = context.creditCycle;
  if (ceiling === null || ceiling <= 0) return null;

  const percent = (spent / ceiling) * 100;
  if (percent < NEAR_PCT) return null;

  const over = percent >= OVER_PCT;
  const currency = context.user.preferredCurrency;
  const pctLabel = Math.floor(percent);
  const spentLabel = formatAmount(spent, currency);
  const ceilingLabel = formatAmount(ceiling, currency);
  const dueLabel = dueDay ? ` A fatura vence dia ${dueDay}.` : '';

  return {
    type: InsightType.FINANCE,
    // Muda a cada ciclo (chave = data de fechamento): o proximo ciclo
    // recomeca do zero e avisa de novo se chegar perto/estourar de novo.
    key: `credit_cycle:${closingDate.toISOString().slice(0, 10)}`,
    severity: over ? InsightSeverity.CRITICAL : InsightSeverity.WARNING,
    message: over
      ? `Seu credito passou do teto deste ciclo: ${spentLabel} de ${ceilingLabel} (${pctLabel}%).${dueLabel} Vale rever os proximos gastos ou ajustar o teto.`
      : `Seu credito ja usou ${pctLabel}% do teto deste ciclo (${spentLabel} de ${ceilingLabel}). Faltam ${formatAmount(ceiling - spent, currency)}.${dueLabel}`,
    metadata: { ceiling, spent, usedPct: pctLabel, dueDay },
  };
}
