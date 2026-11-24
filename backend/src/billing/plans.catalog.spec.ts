import { getCatalog, getPlan, PLAN_RANK } from './plans.catalog';
import { PlanLimitException } from './plan-limit.exception';

describe('plans.catalog', () => {
  it('FREE tem os limites do plano gratis e nao tem precos', () => {
    const p = getCatalog({}).FREE;
    expect(p.id).toBe('FREE');
    expect(p.label).toBe('Grátis');
    expect(p.sellable).toBe(false);
    expect(p.seats).toBe(1);
    expect(p.limits).toEqual({
      goals: 2,
      envelopes: 1,
      recurringTransactions: 3,
      installmentPurchases: 2,
      creditCards: 1,
    });
    expect(p.selahQuestionsPerMonth).toBe(5);
    expect(p.prices).toBeNull();
  });

  it('INDIVIDUAL nao limita itens, limita cartoes a 5, 300 perguntas e precos padrao', () => {
    const p = getCatalog({}).INDIVIDUAL;
    expect(p.label).toBe('Individual');
    expect(p.sellable).toBe(true);
    expect(p.seats).toBe(1);
    expect(p.limits).toEqual({
      goals: null,
      envelopes: null,
      recurringTransactions: null,
      installmentPurchases: null,
      creditCards: 5,
    });
    expect(p.selahQuestionsPerMonth).toBe(300);
    expect(p.prices).toEqual({ MONTHLY: 14.9, YEARLY: 149 });
  });

  it('SHARED e 2 pessoas com 10 cartoes e vendavel desde a 11a-3 (D2/D7/D8)', () => {
    const p = getCatalog({}).SHARED;
    expect(p.label).toBe('Compartilhado');
    expect(p.sellable).toBe(true);
    expect(p.seats).toBe(2);
    expect(p.limits).toEqual({
      goals: null,
      envelopes: null,
      recurringTransactions: null,
      installmentPurchases: null,
      creditCards: 10,
    });
    expect(p.selahQuestionsPerMonth).toBe(300);
    expect(p.prices).toEqual({ MONTHLY: 24.9, YEARLY: 249 });
  });

  it('PLAN_RANK ordena FREE < INDIVIDUAL < SHARED', () => {
    expect(PLAN_RANK.FREE).toBeLessThan(PLAN_RANK.INDIVIDUAL);
    expect(PLAN_RANK.INDIVIDUAL).toBeLessThan(PLAN_RANK.SHARED);
  });

  it('BILLING_PRICE_* sobrescreve o preco', () => {
    const env = {
      BILLING_PRICE_INDIVIDUAL_MONTHLY: '19.9',
      BILLING_PRICE_SHARED_YEARLY: '300',
    } as NodeJS.ProcessEnv;
    expect(getPlan('INDIVIDUAL', env).prices).toEqual({ MONTHLY: 19.9, YEARLY: 149 });
    expect(getPlan('SHARED', env).prices).toEqual({ MONTHLY: 24.9, YEARLY: 300 });
  });

  it.each(['abc', '', '0', '-5', 'NaN', 'Infinity', '  '])('valor invalido "%s" e ignorado', (v) => {
    const env = { BILLING_PRICE_INDIVIDUAL_MONTHLY: v } as NodeJS.ProcessEnv;
    expect(getPlan('INDIVIDUAL', env).prices?.MONTHLY).toBe(14.9);
  });

  it('getCatalog devolve objeto novo a cada chamada', () => {
    const a = getCatalog({});
    a.FREE.limits.goals = 99;
    expect(getCatalog({}).FREE.limits.goals).toBe(2);
  });
});

describe('PlanLimitException', () => {
  it('meta: corpo, mensagem e status 403', () => {
    const e = new PlanLimitException({ resource: 'goals', limit: 2, used: 2, plan: 'FREE' });
    expect(e.getStatus()).toBe(403);
    const body = e.getResponse() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['code', 'error', 'limit', 'message', 'plan', 'resource', 'statusCode', 'used'],
    );
    expect(body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      code: 'PLAN_LIMIT',
      resource: 'goals',
      limit: 2,
      used: 2,
      plan: 'FREE',
    });
    expect(body.message).toBe(
      'Você atingiu o limite de 2 metas ativas do plano Grátis. Veja os planos em Plano.',
    );
  });

  it.each([
    ['envelopes', 1, 'reservas'],
    ['recurringTransactions', 3, 'contas fixas ativas'],
    ['installmentPurchases', 2, 'compras parceladas ativas'],
    ['creditCards', 1, 'cartões ativos'],
    ['selahQuestions', 5, 'perguntas ao Selah neste mês'],
  ] as const)('rotulo de %s', (resource, limit, label) => {
    const e = new PlanLimitException({ resource, limit, used: limit, plan: 'FREE' });
    expect((e.getResponse() as any).message).toContain(`${limit} ${label} do plano Grátis`);
  });

  it('usa o nome do plano Individual e Compartilhado', () => {
    const i = new PlanLimitException({ resource: 'selahQuestions', limit: 300, used: 300, plan: 'INDIVIDUAL' });
    const s = new PlanLimitException({ resource: 'selahQuestions', limit: 300, used: 300, plan: 'SHARED' });
    expect((i.getResponse() as any).message).toContain('do plano Individual.');
    expect((s.getResponse() as any).message).toContain('do plano Compartilhado.');
  });
});
