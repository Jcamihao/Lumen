import { ForbiddenException } from '@nestjs/common';
import { LimitedResource, PlanId } from './plans.catalog';

export type LimitedKey = LimitedResource | 'selahQuestions';

const RESOURCE_LABEL: Record<LimitedKey, string> = {
  goals: 'metas ativas',
  envelopes: 'reservas',
  recurringTransactions: 'contas fixas ativas',
  installmentPurchases: 'compras parceladas ativas',
  selahQuestions: 'perguntas ao Selah neste mês',
};

const PLAN_LABEL: Record<PlanId, string> = {
  FREE: 'Grátis',
  INDIVIDUAL: 'Individual',
  SHARED: 'Compartilhado',
};

export class PlanLimitException extends ForbiddenException {
  constructor(input: {
    resource: LimitedKey;
    limit: number;
    used: number;
    plan: PlanId;
  }) {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: 'PLAN_LIMIT',
      resource: input.resource,
      limit: input.limit,
      used: input.used,
      plan: input.plan,
      message: `Você atingiu o limite de ${input.limit} ${RESOURCE_LABEL[input.resource]} do plano ${PLAN_LABEL[input.plan]}. Veja os planos em Plano.`,
    });
  }
}
