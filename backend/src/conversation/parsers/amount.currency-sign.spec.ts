import { dropTrailingCurrencySign, parseAmountPrefix } from './amount.parser';
import { matchIntent } from './intent.matcher';

describe('cifrao depois do numero', () => {
  it.each([
    ['3$', 300],
    ['3 $', 300],
    ['3,50$', 350],
    ['1.234,56$', 123456],
    ['R$ 3', 300],
    ['R$3', 300],
  ])('valor "%s" = %i centavos', (text, cents) => {
    expect(parseAmountPrefix(text)).toMatchObject({ ok: true, cents });
  });

  it('nao mexe em R$ antes do numero', () => {
    expect(dropTrailingCurrencySign('R$3 no cafe')).toBe('R$3 no cafe');
    expect(dropTrailingCurrencySign('gastei 3$ no cafe')).toBe('gastei 3 no cafe');
  });

  it.each([
    ['Gastei 3$ tomando café na padaria', 'create_expense'],
    ['gastei 3,50$ na padaria', 'create_expense'],
    ['paguei 3$ de pão', 'create_expense'],
    ['recebi 100$ do freela', 'create_income'],
  ])('"%s" vira %s com valor', (text, intent) => {
    const match = matchIntent(text);
    expect(match).toMatchObject({ intent });
    expect(match).not.toHaveProperty('missingAmount');
  });
});
