import { parseCofrinhoBody, parseContributionBody, parseCreateGoalBody, splitTrailingAmount } from './goal.parser';

describe('parseCreateGoalBody', () => {
  it.each([
    ['3 mil viagem', { ok: true, title: 'viagem', targetCents: 300_000 }],
    ['3000 viagem', { ok: true, title: 'viagem', targetCents: 300_000 }],
    ['viagem 3 mil', { ok: true, title: 'viagem', targetCents: 300_000 }],
    ['viagem 3000', { ok: true, title: 'viagem', targetCents: 300_000 }],
    ['viagem 32,90', { ok: true, title: 'viagem', targetCents: 3290 }],
    ['casa nova 1.500', { ok: true, title: 'casa nova', targetCents: 150_000 }],
    ['viagem', { ok: true, title: 'viagem', targetCents: undefined }],
    ['viagem sem alvo', { ok: true, title: 'viagem', targetCents: null }],
    ['3 mil', { ok: true, title: null, targetCents: 300_000 }],
    ['', { ok: true, title: null, targetCents: undefined }],
    // Conectores soltos nas pontas não entram no nome.
    ['de viagem', { ok: true, title: 'viagem', targetCents: undefined }],
    ['de emergência com 5000', { ok: true, title: 'emergência', targetCents: 500_000 }],
    ['de para', { ok: true, title: null, targetCents: undefined }],
    ['viagem 2027', { ok: true, title: 'viagem', targetCents: 202_700 }],
    ['🏖️ praia 2 mil', { ok: true, title: '🏖️ praia', targetCents: 200_000 }],
  ])('"%s"', (body, expected) => {
    expect(parseCreateGoalBody(body)).toEqual(expected);
  });

  it('valor ambíguo no fim pede correção, não chuta', () => {
    expect(parseCreateGoalBody('viagem 1,234')).toEqual({ ok: false, reason: 'AMBIGUOUS' });
  });

  it('valor zero no fim pede correção', () => {
    expect(parseCreateGoalBody('viagem 0')).toEqual({ ok: false, reason: 'ZERO' });
  });

  it('número que não é valor completo continua sendo nome', () => {
    expect(parseCreateGoalBody('casa 2 viagens')).toEqual({ ok: true, title: 'casa 2 viagens', targetCents: undefined });
  });
});

describe('parseContributionBody', () => {
  it.each([
    ['200 na viagem', { ok: true, amountCents: 20_000, name: 'viagem' }],
    ['200 meta viagem', { ok: true, amountCents: 20_000, name: 'viagem' }],
    ['100 na meta casa', { ok: true, amountCents: 10_000, name: 'casa' }],
    ['50 viagem', { ok: true, amountCents: 5000, name: 'viagem' }],
    ['1,5 mil na viagem', { ok: true, amountCents: 150_000, name: 'viagem' }],
    ['30', { ok: true, amountCents: 3000, name: null }],
    ['viagem', { ok: true, amountCents: null, name: 'viagem' }],
    ['', { ok: true, amountCents: null, name: null }],
    ['na', { ok: true, amountCents: null, name: null }],
    ['200 reais na viagem', { ok: true, amountCents: 20_000, name: 'viagem' }],
    ['200 na minha viagem', { ok: true, amountCents: 20_000, name: 'viagem' }],
    ['3k para casa', { ok: true, amountCents: 300_000, name: 'casa' }],
  ])('"%s"', (body, expected) => {
    expect(parseContributionBody(body)).toEqual(expected);
  });

  it('valor inválido no começo devolve o motivo', () => {
    expect(parseContributionBody('0 viagem')).toEqual({ ok: false, reason: 'ZERO' });
    expect(parseContributionBody('1,234 viagem')).toEqual({ ok: false, reason: 'AMBIGUOUS' });
  });
});

describe('parseCofrinhoBody', () => {
  it.each([
    ['viagem', 'viagem'],
    ['viagem de 2027', 'viagem de 2027'],
    ['viagem 500', 'viagem 500'],
    ['viagem sem alvo', 'viagem'],
    ['emergência', 'emergência'],
    ['', null],
    ['de', null],
  ])('"%s"', (body, expected) => {
    expect(parseCofrinhoBody(body)).toEqual(expected);
  });
});

describe('splitTrailingAmount', () => {
  it.each([
    ['viagem 200', { ok: true, amountCents: 20_000, name: 'viagem' }],
    ['viagem 1,5 mil', { ok: true, amountCents: 150_000, name: 'viagem' }],
    ['casa nova 3k', { ok: true, amountCents: 300_000, name: 'casa nova' }],
  ])('"%s"', (name, expected) => {
    expect(splitTrailingAmount(name)).toEqual(expected);
  });

  it('sem valor no fim, ou só o valor, devolve null', () => {
    expect(splitTrailingAmount('dinheiro é importante')).toBeNull();
    expect(splitTrailingAmount('200')).toBeNull();
  });

  it('valor ambíguo ou zero no fim devolve o motivo', () => {
    expect(splitTrailingAmount('viagem 1,234')).toEqual({ ok: false, reason: 'AMBIGUOUS' });
    expect(splitTrailingAmount('viagem 0')).toEqual({ ok: false, reason: 'ZERO' });
  });
});
