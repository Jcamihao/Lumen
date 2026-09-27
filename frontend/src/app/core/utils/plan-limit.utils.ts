/**
 * Le a mensagem de estouro de limite de plano de um erro HTTP, se for o caso.
 * So retorna algo quando o backend responde 403 com `code: 'PLAN_LIMIT'`
 * (ver `PlanLimitException` no backend); qualquer outro erro devolve `null`
 * para que o chamador use sua mensagem padrao de sempre.
 */
export function readPlanLimitMessage(error: unknown): string | null {
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

  return typeof body.message === 'string' ? body.message : null;
}
