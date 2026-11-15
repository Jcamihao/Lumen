import { matchIntent } from './intent.matcher';

describe('matchIntent', () => {
  it.each([
    ['50 mercado', { intent: 'create_expense', body: '50 mercado' }],
    ['gastei 32,90 na farmacia', { intent: 'create_expense', body: '32,90 na farmacia' }],
    ['paguei 2k aluguel', { intent: 'create_expense', body: '2k aluguel' }],
    ['comprei 10 pao', { intent: 'create_expense', body: '10 pao' }],
    ['gastei 0', { intent: 'create_expense', body: '0' }],
    ['recebi 800 de freelance', { intent: 'create_income', body: '800 de freelance' }],
    ['ganhei 300 extra', { intent: 'create_income', body: '300 extra' }],
    ['entrada de 500 salario', { intent: 'create_income', body: '500 salario' }],
    ['saldo', { intent: 'balance' }],
    ['Saldo?', { intent: 'balance' }],
    ['quanto tenho', { intent: 'balance' }],
    ['resumo', { intent: 'month_summary' }],
    ['resumo do mês', { intent: 'month_summary' }],
    ['quanto gastei', { intent: 'spend_total' }],
    ['gastos', { intent: 'spend_total' }],
    ['gastos do mês', { intent: 'spend_total' }],
    ['gastos com Mercado', { intent: 'spend_by_category', categoryQuery: 'Mercado' }],
    ['quanto gastei com alimentação', { intent: 'spend_by_category', categoryQuery: 'alimentação' }],
    ['cartao', { intent: 'credit_card' }],
    ['limite', { intent: 'credit_card' }],
    ['limite do cartão', { intent: 'credit_card' }],
    ['quanto sobrou no cartão', { intent: 'credit_card' }],
    ['ajuda', { intent: 'help' }],
    ['o que você faz?', { intent: 'help' }],
  ])('%s', (text, expected) => {
    expect(matchIntent(text)).toEqual(expected);
  });

  it.each([
    'oi',
    'mercado',
    'limite de mercado',
    'gastos com',
    'gastei muito este mes, o que eu faco?',
    'gastei muito?',
    'comprei um carro novo ontem de manha',
    '',
  ])('nao casa: "%s"', (text) => {
    expect(matchIntent(text)).toBeNull();
  });

  it.each([
    ['gastei mercado', { intent: 'create_expense', body: 'mercado', missingAmount: true }],
    ['gastei com mercado', { intent: 'create_expense', body: 'com mercado', missingAmount: true }],
    ['paguei luz', { intent: 'create_expense', body: 'luz', missingAmount: true }],
    ['gastei', { intent: 'create_expense', body: '', missingAmount: true }],
    ['recebi', { intent: 'create_income', body: '', missingAmount: true }],
    ['recebi freelance', { intent: 'create_income', body: 'freelance', missingAmount: true }],
    ['entrada de salario', { intent: 'create_income', body: 'salario', missingAmount: true }],
  ])('verbo sem valor pede o valor: "%s"', (text, expected) => {
    expect(matchIntent(text)).toEqual(expected);
  });
});
