import { readPlanLimitAction, readPlanLimitMessage } from './plan-limit.utils';

describe('readPlanLimitMessage', () => {
  it('retorna a mensagem quando o erro e 403 com code PLAN_LIMIT', () => {
    const error = {
      status: 403,
      error: {
        code: 'PLAN_LIMIT',
        message: 'Você atingiu o limite de 2 metas ativas do plano Grátis. Veja os planos em Plano.',
      },
    };

    expect(readPlanLimitMessage(error)).toBe(
      'Você atingiu o limite de 2 metas ativas do plano Grátis. Veja os planos em Plano.',
    );
  });

  it('retorna null para 403 sem code PLAN_LIMIT', () => {
    const error = { status: 403, error: { message: 'Acesso negado.' } };

    expect(readPlanLimitMessage(error)).toBeNull();
  });

  it('retorna null para outros status (ex.: 400)', () => {
    const error = { status: 400, error: { code: 'PLAN_LIMIT', message: 'x' } };

    expect(readPlanLimitMessage(error)).toBeNull();
  });

  it('retorna null para null, undefined e string', () => {
    expect(readPlanLimitMessage(null)).toBeNull();
    expect(readPlanLimitMessage(undefined)).toBeNull();
    expect(readPlanLimitMessage('erro qualquer')).toBeNull();
  });

  it('retorna null quando o corpo do erro nao tem message em string', () => {
    const error = { status: 403, error: { code: 'PLAN_LIMIT', message: 123 } };

    expect(readPlanLimitMessage(error)).toBeNull();
  });
});

describe('readPlanLimitAction', () => {
  it('retorna a acao "Ver planos" -> /plano quando o erro e 403 com code PLAN_LIMIT', () => {
    const error = {
      status: 403,
      error: { code: 'PLAN_LIMIT', message: 'Você atingiu o limite do plano Grátis.' },
    };

    expect(readPlanLimitAction(error)).toEqual({ label: 'Ver planos', route: '/plano' });
  });

  it('retorna null para 403 sem code PLAN_LIMIT', () => {
    const error = { status: 403, error: { message: 'Acesso negado.' } };

    expect(readPlanLimitAction(error)).toBeNull();
  });

  it('retorna null para outros status (ex.: 400)', () => {
    const error = { status: 400, error: { code: 'PLAN_LIMIT', message: 'x' } };

    expect(readPlanLimitAction(error)).toBeNull();
  });

  it('retorna null para null, undefined e string', () => {
    expect(readPlanLimitAction(null)).toBeNull();
    expect(readPlanLimitAction(undefined)).toBeNull();
    expect(readPlanLimitAction('erro qualquer')).toBeNull();
  });
});
