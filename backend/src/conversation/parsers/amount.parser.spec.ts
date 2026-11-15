import { MAX_AMOUNT_CENTS, parseAmountPrefix } from './amount.parser';

describe('parseAmountPrefix', () => {
  it.each([
    ['32,90', 3290],
    ['32.90', 3290],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['1234', 123400],
    ['2 mil', 200000],
    ['2k', 200000],
    ['2,5 mil', 250000],
    ['2,5k', 250000],
    ['R$ 10', 1000],
    ['0,5', 50],
  ])('aceita %s como %i centavos', (input, cents) => {
    const result = parseAmountPrefix(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cents).toBe(cents);
    }
  });

  it('separa o resto do texto', () => {
    const result = parseAmountPrefix('50 mercado');
    expect(result).toEqual({ ok: true, cents: 5000, rest: 'mercado' });
  });

  it('separa o resto depois de "mil"', () => {
    expect(parseAmountPrefix('2 mil reais')).toEqual({ ok: true, cents: 200000, rest: 'reais' });
  });

  it.each(['1,234', '1,234.56', '1,234,567'])('pede esclarecimento para ambiguo %s', (input) => {
    expect(parseAmountPrefix(input)).toEqual({ ok: false, reason: 'AMBIGUOUS' });
  });

  it('rejeita zero', () => {
    expect(parseAmountPrefix('0')).toEqual({ ok: false, reason: 'ZERO' });
    expect(parseAmountPrefix('0,00')).toEqual({ ok: false, reason: 'ZERO' });
  });

  it('rejeita negativo', () => {
    expect(parseAmountPrefix('-5')).toEqual({ ok: false, reason: 'NEGATIVE' });
  });

  it('aceita exatamente 1.000.000,00 e rejeita acima', () => {
    expect(parseAmountPrefix('1000000')).toEqual({ ok: true, cents: MAX_AMOUNT_CENTS, rest: '' });
    expect(parseAmountPrefix('1000001')).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(parseAmountPrefix('1.234 mil')).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('texto sem numero no inicio nao e valor', () => {
    expect(parseAmountPrefix('mercado 50')).toEqual({ ok: false, reason: 'NOT_AMOUNT' });
    expect(parseAmountPrefix('10/11 mercado')).toEqual({ ok: false, reason: 'NOT_AMOUNT' });
  });
});
