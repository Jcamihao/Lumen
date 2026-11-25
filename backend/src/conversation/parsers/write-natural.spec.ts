import { matchIntent } from './intent.matcher';

/** Escrita natural (contrato 12.0b, secao 2): verbo informal + valor, parcelado em "em Nx de valor", caixinha. */
describe('escrita natural: positivos', () => {
  it.each([
    // Despesa (contrato 2 e variantes informais)
    ['paguei 80 de luz', { intent: 'create_expense', body: '80 de luz' }],
    ['comprei 120 de racao', { intent: 'create_expense', body: '120 de racao' }],
    ['foi 35 no uber', { intent: 'create_expense', body: '35 no uber' }],
    ['FOI 35 NO UBER', { intent: 'create_expense', body: '35 NO UBER' }],
    ['saiu 200 do pix pro Joao', { intent: 'create_expense', body: '200 do pix pro Joao' }],
    ['saiu R$ 80 da farmacia', { intent: 'create_expense', body: 'R$ 80 da farmacia' }],
    ['torrei 90 no ifood', { intent: 'create_expense', body: '90 no ifood' }],
    ['torrei 2 mil na viagem', { intent: 'create_expense', body: '2 mil na viagem' }],
    ['passei 200 no credito', { intent: 'create_expense', body: '200 no credito' }],
    ['passei 200 no cartão do Itaú', { intent: 'create_expense', body: '200 no cartão do Itaú' }],
    ['foi so 35 no uber', { intent: 'create_expense', body: '35 no uber' }],
    ['torrei ja 40 no bar', { intent: 'create_expense', body: '40 no bar' }],
    ['passei 50,90 no pastel', { intent: 'create_expense', body: '50,90 no pastel' }],
    ['foi 1.200 no notebook', { intent: 'create_expense', body: '1.200 no notebook' }],
    ['saiu 15 conto do cafe', { intent: 'create_expense', body: '15 conto do cafe' }],
    ['gastei 50 no nubank', { intent: 'create_expense', body: '50 no nubank' }],
    ['50 no cartao do itau', { intent: 'create_expense', body: '50 no cartao do itau' }],
    ['50 de gasolina ontem', { intent: 'create_expense', body: '50 de gasolina ontem' }],
    // Parcelado: o valor da parcela vira total (contrato 3b2 le total + "em Nx")
    ['comprei um celular em 10x de 150', { intent: 'create_installment', body: '1500,00 celular em 10x' }],
    ['parcelei a geladeira em 12x de 200', { intent: 'create_installment', body: '2400,00 geladeira em 12x' }],
    ['comprei uma TV em 3x de 500', { intent: 'create_installment', body: '1500,00 TV em 3x' }],
    ['parcelei o sofa em 2x de 1.000', { intent: 'create_installment', body: '2000,00 sofa em 2x' }],
    // Receita
    ['recebi 3000 de salario', { intent: 'create_income', body: '3000 de salario' }],
    ['caiu 500 do freela', { intent: 'create_income', body: '500 do freela' }],
    ['CAIU 500 DO FREELA', { intent: 'create_income', body: '500 DO FREELA' }],
    ['entrou 200 de venda', { intent: 'create_income', body: '200 de venda' }],
    ['entrou ai 300 do aluguel', { intent: 'create_income', body: '300 do aluguel' }],
    ['me pagaram 150', { intent: 'create_income', body: '150' }],
    ['me pagaram 150 conto pelo trampo', { intent: 'create_income', body: '150 conto pelo trampo' }],
    ['caiu 80 reais do pix', { intent: 'create_income', body: '80 reais do pix' }],
    ['ganhei 100 da vovo', { intent: 'create_income', body: '100 da vovo' }],
    // Guardar em meta/cofrinho/caixinha
    ['guardei 200 na viagem', { intent: 'contribute_goal', body: '200 na viagem' }],
    ['GUARDEI 200 NA VIAGEM', { intent: 'contribute_goal', body: '200 NA VIAGEM' }],
    ['guardei 200 pra viagem', { intent: 'contribute_goal', body: '200 pra viagem' }],
    ['coloquei 200 na minha caixinha', { intent: 'contribute_goal', body: '200 na minha caixinha' }],
    ['coloquei 300 na caixinha viagem', { intent: 'contribute_goal', body: '300 na caixinha viagem' }],
    ['juntei 100 pra moto', { intent: 'contribute_goal', body: '100 pra moto' }],
    ['juntei 1.200 pro carro', { intent: 'contribute_goal', body: '1.200 pro carro' }],
    ['depositei 50 no cofrinho', { intent: 'contribute_goal', body: '50 no cofrinho' }],
    ['separei 300 pra meta X', { intent: 'contribute_goal', body: '300 pra meta X' }],
    ['poupei 80 na viagem', { intent: 'contribute_goal', body: '80 na viagem' }],
    ['separei 300 pra reserva da meta X', { intent: 'contribute_goal', body: '300 pra reserva da meta X' }],
    ['guardei 50,90 pra viagem', { intent: 'contribute_goal', body: '50,90 pra viagem' }],
    ['guardei 200 reais na viagem', { intent: 'contribute_goal', body: '200 reais na viagem' }],
    // Caixinha como sinonimo de meta em criar, listar e apagar
    ['criar caixinha Viagem', { intent: 'create_goal', body: 'Viagem' }],
    ['nova caixinha moto', { intent: 'create_goal', body: 'moto' }],
    ['minhas caixinhas', { intent: 'goals' }],
    ['apagar caixinha viagem', { intent: 'delete_goal', body: 'viagem' }],
    ['editar caixinha viagem', { intent: 'edit_goal', body: 'viagem' }],
  ])('reconhece "%s"', (text, expected) => {
    expect(matchIntent(text)).toEqual(expected);
  });
});

describe('escrita natural: negativos (pergunta, negacao, hipotese, sem valor, verbo no meio)', () => {
  it.each([
    'sera que gastei 50?',
    'sera que gastei 50',
    'nao gastei 50',
    'nunca guardei 200',
    'se eu gastar 50',
    'quanto foi 35 no uber?',
    'quanto foi 35 no uber',
    'foi 35 no uber?',
    'recebi 800?',
    'caiu 500?',
    'caiu 500 do freela? nao sei',
    'caiu a internet',
    'por que meu saldo caiu?',
    'o preco do uber foi 35 ontem pra mim hoje',
    'foi uma semana boa',
    'foi bom',
    'passei no mercado',
    'passei o dia inteiro no trabalho',
    'saiu cedo 200',
    'pagaram 150',
    'me pagaram',
    'me pagaram 150?',
    'entrou 200?',
    'entrou 200 de venda, quanto deu?',
    'juntei',
    'separei tudo',
    'separei 300',
    'guardei 200',
    'poupei 80',
    'guardei 200 na viagem?',
    'coloquei 200?',
    'juntei 100 pra moto?',
    'guardei 200 na',
    'hoje 500 do freela caiu',
    `foi 35 no ${'a'.repeat(510)}`,
    'separei 300 pra',
    'depositei?',
    'quero guardar 200 na viagem',
    'vou guardar 200 na viagem',
    'comprei um celular em 10x',
    'comprei um celular em 10x de 150?',
    'passei 200 vezes la',
    'passei 2 vezes no mercado',
    'entrou 2 vezes',
    'entrou 2 pessoas na fila',
    'saiu 2 vezes de casa',
    'foi 2 vezes la',
    'foi 3 dias no hotel',
    'coloquei 200 litros de gasolina',
    'juntei 100 amigos',
    'coloquei 200 no bolso',
    'coloquei 200 na mesa',
    'coloquei 50 reais de gasolina no carro',
    'depositei 50 no banco',
    'depositei 50 na conta do joao',
    'separei 300 pra comida',
    'juntei 100 pessoas na festa',
    'guardei 2 caixas na garagem',
    'separei 300 doces pra festa',
    'separei 3 brigadeiros pra mim',
    'guardei 200 viagem',
    'comprei um celular em 10x de 150 ontem',
    'parcelei a geladeira',
    'comprei um tenis em 10x sem 150',
    'comprei em 12x de 200',
    'parcelei em 12x de 200',
    'parcelei a geladeira em 12x de 200?',
    'comprei um carro novo ontem de manha',
    'foi legal conversar com voce hoje a noite sobre o plano',
    'foi 35 no uber e depois fui pra casa com a familia toda e comemos muito bem no jantar de hoje a noite',
  ])('nao vira escrita: "%s"', (text) => {
    expect(matchIntent(text)).toBeNull();
  });
});

describe('escrita natural: regras de forma', () => {
  it('ponto final no fim nao muda a intencao', () => {
    expect(matchIntent('foi 35 no uber.')?.intent).toBe('create_expense');
    expect(matchIntent('caiu 500 do freela!')?.intent).toBe('create_income');
  });

  it('chamar duas vezes a mesma frase devolve o mesmo resultado', () => {
    const text = 'comprei um celular em 10x de 150';
    expect(matchIntent(text)).toEqual(matchIntent(text));
  });

  it('com "?" os verbos antigos seguem como na develop (rascunho)', () => {
    expect(matchIntent('gastei 50 mercado?')).toEqual({ intent: 'create_expense', body: '50 mercado?' });
    expect(matchIntent('gastei 50 no mercado ontem?')?.intent).toBe('create_expense');
    expect(matchIntent('recebi 800 de freelance?')?.intent).toBe('create_income');
    expect(matchIntent('50 mercado?')?.intent).toBe('create_expense');
    expect(matchIntent('recebi 800?')).toBeNull();
  });

  it('parcelado aceita "reais" depois da parcela', () => {
    expect(matchIntent('comprei um celular em 10x de 150 reais')).toEqual({
      intent: 'create_installment',
      body: '1500,00 celular em 10x',
    });
  });

  it('com "?" o informal nunca vira escrita, mesmo com valor certo', () => {
    expect(matchIntent('caiu 500 do freela?')).toBeNull();
    expect(matchIntent('guardei 200 na viagem?')).toBeNull();
  });
});
