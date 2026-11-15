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
    ['cartão', { intent: 'credit_card' }],
    ['ajuda', { intent: 'help' }],
    ['o que você faz?', { intent: 'help' }],
    ['o que vence', { intent: 'upcoming_dues' }],
    ['Vencimentos', { intent: 'upcoming_dues' }],
    ['próximos vencimentos', { intent: 'upcoming_dues' }],
    ['contas a vencer', { intent: 'upcoming_dues' }],
    ['minhas parcelas', { intent: 'installments' }],
    ['parcelas', { intent: 'installments' }],
    ['parcelados', { intent: 'installments' }],
    ['compras parceladas', { intent: 'installments' }],
    ['contas fixas', { intent: 'fixed_bills' }],
    ['despesas fixas', { intent: 'fixed_bills' }],
    ['gastos recorrentes', { intent: 'fixed_bills' }],
    ['recorrências', { intent: 'fixed_bills' }],
    ['minhas metas', { intent: 'goals' }],
    ['metas', { intent: 'goals' }],
    ['minhas reservas', { intent: 'goals' }],
    ['reservas', { intent: 'goals' }],
    ['como está minha reserva', { intent: 'goals' }],
    ['metas de viagem', { intent: 'goals' }],
    ['o que vence?', { intent: 'upcoming_dues' }],
    ['minhas parcelas?', { intent: 'installments' }],
    ['contas fixas?', { intent: 'fixed_bills' }],
    ['metas?', { intent: 'goals' }],
    ['o que vence esta semana', { intent: 'upcoming_dues' }],
    ['metas do ano', { intent: 'goals' }],
    ['metas para o ano', { intent: 'goals' }],
    // Comando curto com complemento: lista tudo, como "saldo do cartão" já faz.
    ['recorrências do cartão', { intent: 'fixed_bills' }],
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
    // Sugestões prontas da tela do Selah (contrato 2): não podem virar consulta.
    'Como posso acelerar minhas metas financeiras?',
    'Qual meta merece aporte agora?',
    'Analise meus gastos do mês',
    'Como estou hoje?',
    // "vencimento" no meio da frase, sem começar pela consulta.
    'quando vence minha fatura',
    // Frase da consulta no começo, mas é pergunta livre: vai ao Selah.
    'minhas metas estão boas?',
    'metas de emagrecimento do ano',
    'parcelas do carro: vale a pena?',
    'parcelas do carro vale a pena',
    'reservas de emergência: quanto devo ter?',
    'metas estão boas?',
    'o que vence na próxima semana?',
    'contas fixas ou variáveis, o que muda?',
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
