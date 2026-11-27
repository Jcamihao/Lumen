import { startOfDay } from 'date-fns';
import { ChargeOccurrence } from '../insight.types';

/**
 * Agrupa despesas por descricao normalizada e valor, no mesmo espirito do
 * fingerprint usado na deduplicacao de importacao de CSV.
 */
export function groupChargesByFingerprint(charges: ChargeOccurrence[]): ChargeOccurrence[][] {
  const groups = new Map<string, ChargeOccurrence[]>();

  for (const charge of charges) {
    const fingerprint = `${charge.description.trim().toLowerCase()}:${charge.amount}`;
    const group = groups.get(fingerprint);
    if (group) {
      group.push(charge);
    } else {
      groups.set(fingerprint, [charge]);
    }
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Mantem uma ocorrencia por dia, em ordem crescente, para que uma cobranca
 * duplicada no mesmo dia nao seja confundida com ciclo de assinatura.
 */
export function collapseToUniqueDays(charges: ChargeOccurrence[]): ChargeOccurrence[] {
  const byDay = new Map<string, ChargeOccurrence>();
  for (const charge of charges) {
    const dayKey = startOfDay(charge.date).toISOString();
    if (!byDay.has(dayKey)) byDay.set(dayKey, charge);
  }
  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
