import {
  GRACE_DAYS,
  SubscriptionLike,
  currentMonthWindow,
  pickEffectivePlan,
  subscriptionGrantsAccess,
} from './access.util';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-27T12:00:00.000Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const sub = (
  status: SubscriptionLike['status'],
  currentPeriodEnd: Date | null,
  plan: SubscriptionLike['plan'] = 'INDIVIDUAL',
  source: SubscriptionLike['source'] = 'ASAAS',
): SubscriptionLike => ({ plan, status, currentPeriodEnd, source });
const grant = (
  status: SubscriptionLike['status'],
  currentPeriodEnd: Date | null,
  plan: SubscriptionLike['plan'] = 'SHARED',
) => sub(status, currentPeriodEnd, plan, 'GRANT');

describe('subscriptionGrantsAccess', () => {
  it('GRACE_DAYS e 7', () => {
    expect(GRACE_DAYS).toBe(7);
  });

  it.each(['ACTIVE', 'PAST_DUE'] as const)('%s', (status) => {
    expect(subscriptionGrantsAccess(sub(status, at(DAY)), now)).toBe(true);
    expect(subscriptionGrantsAccess(sub(status, now), now)).toBe(true);
    // fim + 7d exatamente = agora  -> fim = now - 7d
    expect(subscriptionGrantsAccess(sub(status, at(-7 * DAY)), now)).toBe(true);
    // fim + 7d + 1ms = agora - 1ms... ou seja fim = now - 7d - 1ms
    expect(subscriptionGrantsAccess(sub(status, at(-7 * DAY - 1)), now)).toBe(false);
    expect(subscriptionGrantsAccess(sub(status, at(-30 * DAY)), now)).toBe(false);
  });

  it('assinatura paga (ASAAS) 3 dias apos o fim ainda tem acesso (tolerancia)', () => {
    expect(subscriptionGrantsAccess(sub('ACTIVE', at(-3 * DAY)), now)).toBe(true);
  });

  it('ACTIVE/PAST_DUE com fim null sempre tem acesso', () => {
    expect(subscriptionGrantsAccess(grant('ACTIVE', null), now)).toBe(true);
    expect(subscriptionGrantsAccess(grant('PAST_DUE', null), now)).toBe(true);
    expect(subscriptionGrantsAccess(sub('ACTIVE', null), now)).toBe(true);
  });

  describe('concessao (GRANT) nao tem tolerancia de atraso', () => {
    it('vencida ha 1 dia nao da acesso', () => {
      expect(subscriptionGrantsAccess(grant('ACTIVE', at(-DAY)), now)).toBe(false);
    });

    it('fim exatamente agora da acesso; 1ms antes nao', () => {
      expect(subscriptionGrantsAccess(grant('ACTIVE', now), now)).toBe(true);
      expect(subscriptionGrantsAccess(grant('ACTIVE', at(-1)), now)).toBe(false);
    });

    it('fim no futuro da acesso', () => {
      expect(subscriptionGrantsAccess(grant('ACTIVE', at(DAY)), now)).toBe(true);
    });
  });

  it('CANCELED ate o fim tem acesso, fim + 1ms nao', () => {
    expect(subscriptionGrantsAccess(sub('CANCELED', now), now)).toBe(true);
    expect(subscriptionGrantsAccess(sub('CANCELED', at(DAY)), now)).toBe(true);
    expect(subscriptionGrantsAccess(sub('CANCELED', at(-1)), now)).toBe(false);
  });

  it('CANCELED sem fim nao da acesso', () => {
    expect(subscriptionGrantsAccess(sub('CANCELED', null), now)).toBe(false);
  });

  it.each(['PENDING', 'EXPIRED'] as const)('%s nunca da acesso', (status) => {
    expect(subscriptionGrantsAccess(sub(status, at(30 * DAY)), now)).toBe(false);
    expect(subscriptionGrantsAccess(sub(status, null), now)).toBe(false);
  });
});

describe('pickEffectivePlan', () => {
  it('sem assinaturas e FREE', () => {
    expect(pickEffectivePlan([], now)).toBe('FREE');
  });

  it('vence o maior plano com acesso', () => {
    const subs = [sub('ACTIVE', at(DAY), 'INDIVIDUAL'), sub('ACTIVE', at(DAY), 'SHARED')];
    expect(pickEffectivePlan(subs, now)).toBe('SHARED');
    expect(pickEffectivePlan([...subs].reverse(), now)).toBe('SHARED');
  });

  it('assinatura sem acesso e ignorada', () => {
    expect(pickEffectivePlan([sub('EXPIRED', at(DAY))], now)).toBe('FREE');
    expect(
      pickEffectivePlan([sub('ACTIVE', at(DAY), 'INDIVIDUAL'), sub('EXPIRED', at(DAY), 'SHARED')], now),
    ).toBe('INDIVIDUAL');
  });

  it('concessao (fim null) da acesso; concessao vencida ha mais de 7d nao', () => {
    expect(pickEffectivePlan([grant('ACTIVE', null, 'SHARED')], now)).toBe('SHARED');
    expect(pickEffectivePlan([grant('ACTIVE', at(-8 * DAY), 'SHARED')], now)).toBe('FREE');
  });

  it('concessao vencida e ignorada; paga ativa prevalece', () => {
    expect(
      pickEffectivePlan([sub('ACTIVE', at(DAY), 'INDIVIDUAL'), grant('ACTIVE', at(-2 * DAY), 'SHARED')], now),
    ).toBe('INDIVIDUAL');
  });

  it('concessao valida maior que a paga vence', () => {
    expect(
      pickEffectivePlan([grant('ACTIVE', at(DAY), 'SHARED'), sub('ACTIVE', at(DAY), 'INDIVIDUAL')], now),
    ).toBe('SHARED');
  });
});

describe('currentMonthWindow', () => {
  const iso = (w: { start: Date; end: Date }) => [w.start.toISOString(), w.end.toISOString()];

  it('02:59:59Z de 1/out ainda e setembro em Sao Paulo', () => {
    expect(iso(currentMonthWindow(new Date('2026-10-01T02:59:59Z')))).toEqual([
      '2026-09-01T03:00:00.000Z',
      '2026-10-01T03:00:00.000Z',
    ]);
  });

  it('03:00:00Z de 1/out ja e outubro', () => {
    expect(iso(currentMonthWindow(new Date('2026-10-01T03:00:00Z')))).toEqual([
      '2026-10-01T03:00:00.000Z',
      '2026-11-01T03:00:00.000Z',
    ]);
  });

  it('meio do mes', () => {
    expect(iso(currentMonthWindow(new Date('2026-09-15T18:30:00Z')))).toEqual([
      '2026-09-01T03:00:00.000Z',
      '2026-10-01T03:00:00.000Z',
    ]);
  });

  it('virada de dezembro para janeiro', () => {
    expect(iso(currentMonthWindow(new Date('2026-12-20T10:00:00Z')))).toEqual([
      '2026-12-01T03:00:00.000Z',
      '2027-01-01T03:00:00.000Z',
    ]);
    expect(iso(currentMonthWindow(new Date('2027-01-01T02:59:59Z')))).toEqual([
      '2026-12-01T03:00:00.000Z',
      '2027-01-01T03:00:00.000Z',
    ]);
  });

  it('03:00:00Z de 1/jan ja e janeiro', () => {
    expect(iso(currentMonthWindow(new Date('2027-01-01T03:00:00Z')))).toEqual([
      '2027-01-01T03:00:00.000Z',
      '2027-02-01T03:00:00.000Z',
    ]);
  });

  it('fevereiro bissexto (2028)', () => {
    expect(iso(currentMonthWindow(new Date('2028-02-15T12:00:00Z')))).toEqual([
      '2028-02-01T03:00:00.000Z',
      '2028-03-01T03:00:00.000Z',
    ]);
  });
});
