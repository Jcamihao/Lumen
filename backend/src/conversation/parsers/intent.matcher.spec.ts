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
    ['minhas reservas', { intent: 'envelopes' }],
    ['reservas', { intent: 'envelopes' }],
    ['como está minha reserva', { intent: 'envelopes' }],
    ['envelopes', { intent: 'envelopes' }],
    ['reservas?', { intent: 'envelopes' }],
    ['metas de viagem', { intent: 'goals' }],
    // Escrita de meta (contrato 3b1, secao 3): o corpo fica para o motor.
    ['criar meta viagem 3 mil', { intent: 'create_goal', body: 'viagem 3 mil' }],
    ['nova meta', { intent: 'create_goal', body: '' }],
    ['criar cofrinho casa', { intent: 'create_goal', body: 'casa', cofrinho: true }],
    ['criar meta casa', { intent: 'create_goal', body: 'casa' }],
    ['guardar 200 na viagem', { intent: 'contribute_goal', body: '200 na viagem' }],
    ['aportar 200 meta viagem', { intent: 'contribute_goal', body: '200 meta viagem' }],
    ['colocar 100 na meta casa', { intent: 'contribute_goal', body: '100 na meta casa' }],
    ['aporte de 50 viagem', { intent: 'contribute_goal', body: '50 viagem' }],
    ['poupar 30', { intent: 'contribute_goal', body: '30' }],
    ['depositar 80 viagem', { intent: 'contribute_goal', body: '80 viagem' }],
    ['guardar viagem', { intent: 'contribute_goal', body: 'viagem' }],
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
    // Escrita de meta: pergunta longa ou com "?" vai ao Selah (contrato 3b1, secao 7).
    'quanto devo guardar por mês?',
    'qual meta merece aporte agora?',
    'criar uma meta para o ano que vem é boa ideia?',
    'criar meta para o ano que vem e aportes mensais',
    'guardar dinheiro é importante?',
    'guardar 200 na viagem?',
    // Lote de frases naturais da revisão do 3b1: perguntas, pedidos longos e verbo fora de ordem.
    'colocar dinheiro na poupança vale a pena?',
    'como criar meta de viagem?',
    'aporte de emergência é útil?',
    'devo poupar mais este mês',
    'quero guardar 200 na viagem',
    'viagem guardar 200',
    'criar uma meta',
    'criar metas de longo prazo',
    'criar meta de viagem para o ano que vem',
    'como poupar dinheiro',
    'guardei 200',
    'aporte',
    'criar reserva?',
    // Conta fixa e parcelado: pergunta ou frase longa não vira escrita (contrato 3b2, secao 4).
    'criar conta fixa internet?',
    'como criar conta fixa?',
    'criar parcelado 1200 geladeira em 12x?',
    'quero criar um parcelado para a geladeira',
    'contas fixas do mes que vem',
    // Sem o verbo "criar/nova/novo" o texto não é comando de escrita (o prefixo é explícito).
    'conta fixa',
    'conta fixa 120 internet',
    'parcelado',
    'parcelado 1200 geladeira em 12x',
    'parcelas do carro valem a pena',
    'definir limite? 5000',
    'como definir limite do cartão?',
  ])('nao casa: "%s"', (text) => {
    expect(matchIntent(text)).toBeNull();
  });

  it.each([
    ['criar reserva 400 gasolina', { intent: 'create_envelope', body: '400 gasolina' }],
    ['nova reserva gasolina', { intent: 'create_envelope', body: 'gasolina' }],
    ['criar envelope 3 mil viagem', { intent: 'create_envelope', body: '3 mil viagem' }],
    ['criar reserva', { intent: 'create_envelope', body: '' }],
    ['definir limite do cartão 5 mil', { intent: 'set_credit_limit', body: '5 mil' }],
    ['definir limite 5000 Nubank', { intent: 'set_credit_limit', body: '5000 Nubank' }],
    ['definir limite do cartão', { intent: 'set_credit_limit', body: '' }],
    ['criar conta fixa 120 internet mensal primeiro 20/11/2026', { intent: 'create_recurring', body: '120 internet mensal primeiro 20/11/2026' }],
    ['nova conta fixa', { intent: 'create_recurring', body: '' }],
    ['criar parcelado 1200 geladeira em 12x primeiro 20/11/2026', { intent: 'create_installment', body: '1200 geladeira em 12x primeiro 20/11/2026' }],
    ['novo parcelado', { intent: 'create_installment', body: '' }],
  ])('comando de reserva, limite, conta fixa e parcelado: "%s"', (text, expected) => {
    expect(matchIntent(text)).toEqual(expected);
  });

  it('reserva e limite: 20 palavras casam, 21 não', () => {
    // 2 palavras do comando + corpo: 20 no total casa; 21 não.
    const twenty = `criar reserva ${Array(18).fill('a').join(' ')}`;
    const twentyOne = `criar reserva ${Array(19).fill('a').join(' ')}`;
    expect(matchIntent(twenty)).toMatchObject({ intent: 'create_envelope' });
    expect(matchIntent(twentyOne)).toBeNull();
  });

  it('conta fixa e parcelado: 20 palavras casam, 21 não', () => {
    // "criar conta fixa" são 3 palavras; "criar parcelado" são 2.
    const twenty = `criar conta fixa ${Array(17).fill('a').join(' ')}`;
    const twentyOne = `criar conta fixa ${Array(18).fill('a').join(' ')}`;
    const parcelado = `criar parcelado ${Array(18).fill('a').join(' ')}`;
    expect(matchIntent(parcelado)).toMatchObject({ intent: 'create_installment' });
    expect(matchIntent(twenty)).toMatchObject({ intent: 'create_recurring' });
    expect(matchIntent(twentyOne)).toBeNull();
  });

  it('leituras de contas fixas e parcelas continuam leituras', () => {
    expect(matchIntent('contas fixas')).toEqual({ intent: 'fixed_bills' });
    expect(matchIntent('parcelas')).toEqual({ intent: 'installments' });
    expect(matchIntent('parcelados')).toEqual({ intent: 'installments' });
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
