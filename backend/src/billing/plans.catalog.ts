export type PlanId = 'FREE' | 'INDIVIDUAL' | 'SHARED';
export type LimitedResource =
  | 'goals'
  | 'envelopes'
  | 'recurringTransactions'
  | 'installmentPurchases'
  // Cartões ativos (contrato 11, D7): fecha a pendencia do item 9 — o teto tecnico de 10 do 9a
  // virou o limite do SHARED; 11a-1 aplica no CreditCardsService.
  | 'creditCards';

export interface PlanDefinition {
  id: PlanId;
  label: string;
  sellable: boolean;
  seats: number;
  limits: Record<LimitedResource, number | null>;
  selahQuestionsPerMonth: number | null;
  prices: { MONTHLY: number; YEARLY: number } | null;
}

export const PLAN_RANK: Record<PlanId, number> = {
  FREE: 0,
  INDIVIDUAL: 1,
  SHARED: 2,
};

/** Preço vindo da env `BILLING_PRICE_<PLANO>_<MONTHLY|YEARLY>`; inválido (não numérico ou <= 0) é ignorado. */
function price(
  env: NodeJS.ProcessEnv,
  plan: 'INDIVIDUAL' | 'SHARED',
  interval: 'MONTHLY' | 'YEARLY',
  fallback: number,
): number {
  const raw = env[`BILLING_PRICE_${plan}_${interval}`];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getCatalog(
  env: NodeJS.ProcessEnv = process.env,
): Record<PlanId, PlanDefinition> {
  const unlimited = (creditCards: number): Record<LimitedResource, number | null> => ({
    goals: null,
    envelopes: null,
    recurringTransactions: null,
    installmentPurchases: null,
    creditCards,
  });

  return {
    FREE: {
      id: 'FREE',
      label: 'Grátis',
      sellable: false,
      seats: 1,
      limits: {
        goals: 2,
        envelopes: 1,
        recurringTransactions: 3,
        installmentPurchases: 2,
        creditCards: 1,
      },
      selahQuestionsPerMonth: 5,
      prices: null,
    },
    INDIVIDUAL: {
      id: 'INDIVIDUAL',
      label: 'Individual',
      sellable: true,
      seats: 1,
      limits: unlimited(5),
      selahQuestionsPerMonth: 300,
      prices: {
        MONTHLY: price(env, 'INDIVIDUAL', 'MONTHLY', 14.9),
        YEARLY: price(env, 'INDIVIDUAL', 'YEARLY', 149),
      },
    },
    SHARED: {
      id: 'SHARED',
      label: 'Compartilhado',
      // D8 (dono, contrato 11): o interruptor do preco virou true no fechamento da 11a,
      // com o app de grupo pronto. Metade do preco e do pagamento, nao por pessoa.
      sellable: true,
      // D2 (dono, 2026-11-24): 2 pessoas no lancamento; para evoluir ate 4 e trocar aqui.
      seats: 2,
      limits: unlimited(10),
      selahQuestionsPerMonth: 300,
      prices: {
        MONTHLY: price(env, 'SHARED', 'MONTHLY', 24.9),
        YEARLY: price(env, 'SHARED', 'YEARLY', 249),
      },
    },
  };
}

export function getPlan(
  id: PlanId,
  env: NodeJS.ProcessEnv = process.env,
): PlanDefinition {
  return getCatalog(env)[id];
}
