import { PLAN_RANK, PlanId } from './plans.catalog';

export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3 fixo (sem horário de verão)

export interface SubscriptionLike {
  plan: 'INDIVIDUAL' | 'SHARED';
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  currentPeriodEnd: Date | null;
}

export function subscriptionGrantsAccess(
  sub: SubscriptionLike,
  now: Date,
): boolean {
  const end = sub.currentPeriodEnd?.getTime() ?? null;
  const t = now.getTime();
  switch (sub.status) {
    case 'ACTIVE':
    case 'PAST_DUE':
      return end === null || t <= end + GRACE_DAYS * DAY_MS;
    case 'CANCELED':
      return end !== null && t <= end;
    default:
      return false;
  }
}

export function pickEffectivePlan(
  subs: SubscriptionLike[],
  now: Date,
): PlanId {
  let best: PlanId = 'FREE';
  for (const sub of subs) {
    if (subscriptionGrantsAccess(sub, now) && PLAN_RANK[sub.plan] > PLAN_RANK[best]) {
      best = sub.plan;
    }
  }
  return best;
}

/** Janela [start, end) do mês corrente em America/Sao_Paulo, em instantes UTC. */
export function currentMonthWindow(now: Date): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1, 3)),
    end: new Date(Date.UTC(y, m + 1, 1, 3)),
  };
}
