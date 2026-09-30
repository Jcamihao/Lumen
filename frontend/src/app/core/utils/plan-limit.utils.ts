type PlanLimitErrorBody = { code: 'PLAN_LIMIT'; message: unknown };

/**
 * Detecta se um erro HTTP e um estouro de limite de plano (403 com
 * `code: 'PLAN_LIMIT'`, ver `PlanLimitException` no backend) e devolve o
 * corpo do erro nesse caso, ou `null` caso contrario. Usado por
 * `readPlanLimitMessage` e `readPlanLimitAction` para compartilhar a mesma
 * deteccao.
 */
function readPlanLimitErrorBody(error: unknown): PlanLimitErrorBody | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const httpError = error as { status?: unknown; error?: { code?: unknown; message?: unknown } };
  if (httpError.status !== 403) {
    return null;
  }

  const body = httpError.error;
  if (!body || body.code !== 'PLAN_LIMIT') {
    return null;
  }

  return body as PlanLimitErrorBody;
}

/**
 * Le a mensagem de estouro de limite de plano de um erro HTTP, se for o caso.
 * So retorna algo quando o backend responde 403 com `code: 'PLAN_LIMIT'`
 * (ver `PlanLimitException` no backend); qualquer outro erro devolve `null`
 * para que o chamador use sua mensagem padrao de sempre.
 */
export function readPlanLimitMessage(error: unknown): string | null {
  const body = readPlanLimitErrorBody(error);
  if (!body) {
    return null;
  }

  return typeof body.message === 'string' ? body.message : null;
}

/**
 * Le a acao (label + rota) pra resolver um estouro de limite de plano, se
 * for o caso. Mesma deteccao de `readPlanLimitMessage`: so retorna algo para
 * 403 com `code: 'PLAN_LIMIT'`; qualquer outro erro devolve `null`.
 */
export function readPlanLimitAction(error: unknown): { label: string; route: string } | null {
  const body = readPlanLimitErrorBody(error);
  if (!body) {
    return null;
  }

  return { label: 'Ver planos', route: '/plano' };
}
