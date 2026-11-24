import { matchIntent } from './intent.matcher';

describe('matcher do limite por cartao e limpar teto (8d)', () => {
  it('definir/mudar/novo limite aceitam o nome do cartao no corpo', () => {
    expect(matchIntent('definir limite do nubank 2000')).toEqual({ intent: 'set_credit_limit', body: 'do nubank 2000' });
    expect(matchIntent('definir limite nubank 2 mil')).toEqual({ intent: 'set_credit_limit', body: 'nubank 2 mil' });
    expect(matchIntent('mudar limite do cartao itau 3500')).toEqual({ intent: 'set_credit_limit', body: 'itau 3500' });
    expect(matchIntent('mudar limite nubank')).toEqual({ intent: 'set_credit_limit', body: 'nubank' });
    expect(matchIntent('alterar limite 4000')).toEqual({ intent: 'set_credit_limit', body: '4000' });
    expect(matchIntent('novo limite')).toEqual({ intent: 'set_credit_limit', body: '' });
  });

  it('forma curta "limite do <nome>" e escrita; "limite do cartao" continua leitura', () => {
    expect(matchIntent('limite do nubank 1.500')).toEqual({ intent: 'set_credit_limit', body: 'nubank 1.500' });
    expect(matchIntent('limite da caixa 900')).toEqual({ intent: 'set_credit_limit', body: 'caixa 900' });
    expect(matchIntent('limite')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('limite do cartao')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('definir limite do cartao')).toEqual({ intent: 'set_credit_limit', body: '' });
    expect(matchIntent('definir limite do cartao 2000')).toEqual({ intent: 'set_credit_limit', body: '2000' });
  });

  it('limpar/remover/tirar teto vira clear_credit_limit com o termo do cartao', () => {
    expect(matchIntent('limpar limite')).toEqual({ intent: 'clear_credit_limit', body: '' });
    expect(matchIntent('limpar o limite do nubank')).toEqual({ intent: 'clear_credit_limit', body: 'do nubank' });
    expect(matchIntent('remover limite nubank')).toEqual({ intent: 'clear_credit_limit', body: 'nubank' });
    expect(matchIntent('tirar limite da caixa')).toEqual({ intent: 'clear_credit_limit', body: 'da caixa' });
    expect(matchIntent('limpar teto')).toEqual({ intent: 'clear_credit_limit', body: '' });
  });

  it('perguntas e frases longas continuam fora', () => {
    expect(matchIntent('limpar limite do nubank?')).toBeNull();
    // Sem a palavra cartao, o matcher so separa a forma; quem decide se e cartao e o servico (nome exato).
    expect(matchIntent('limite do nubank estourou')).toEqual({ intent: 'credit_card', cardTerm: 'nubank estourou', loose: true });
    expect(matchIntent('limite do nubank?')).toBeNull();
    expect(matchIntent('limite do nubank')).toEqual({ intent: 'credit_card', cardTerm: 'nubank', loose: true }); // leitura so se for cartao (servico)
  });

  it('nome generico nao vale: "limite do cartao 2000" continua leitura', () => {
    expect(matchIntent('limite do cartao 2000')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('limite do credito 2000')).toBeNull(); // como antes da 8d: nao e frase de leitura
  });
});

describe('leitura por cartao e meus cartoes (9b-2)', () => {
  it('"cartao X" e explicito: nome vai na leitura, sem loose', () => {
    expect(matchIntent('cartao Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank' });
    expect(matchIntent('cartão do Itaú')).toEqual({ intent: 'credit_card', cardTerm: 'Itaú' });
    expect(matchIntent('limite do cartao Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank' });
    expect(matchIntent('quanto sobrou no cartao Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank' });
  });

  it('"no/do X" sem a palavra cartao vira leitura loose (o servico confere o nome)', () => {
    expect(matchIntent('quanto sobrou no Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank', loose: true });
    expect(matchIntent('quanto gastei no Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank', loose: true });
    expect(matchIntent('fatura do Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank', loose: true });
    expect(matchIntent('fatura da Itaú')).toEqual({ intent: 'credit_card', cardTerm: 'Itaú', loose: true });
    expect(matchIntent('limite na Itaú')).toEqual({ intent: 'credit_card', cardTerm: 'Itaú', loose: true });
  });

  it('pergunta com "?" ou nome longo nao vira leitura loose', () => {
    expect(matchIntent('quanto sobrou no Nubank?')).toBeNull();
    expect(matchIntent('quanto gastei no mercado esse mes com meu dinheiro')).toBeNull();
  });

  it('forma sem nome continua como antes (cartao padrao)', () => {
    expect(matchIntent('quanto sobrou no cartão')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('fatura do cartão')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('limite do cartão')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('cartão')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('quanto gastei no credito')).toBeNull();
    expect(matchIntent('quanto sobrou no')).toBeNull();
  });

  it('com valor na frase nao e leitura por cartao (escrita 8d ou fluxo antigo)', () => {
    expect(matchIntent('limite do cartao 2000')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('limite do credito 2000')).toBeNull();
    expect(matchIntent('definir limite do nubank 2000')).toEqual({ intent: 'set_credit_limit', body: 'do nubank 2000' });
    expect(matchIntent('quanto gastei no nubank 50')).toBeNull();
  });

  it('"meus cartoes" e variantes listam os cartoes', () => {
    for (const text of ['meus cartoes', 'Meus cartões?', 'quais cartoes', 'listar cartoes', 'meus cartões de crédito']) {
      expect(matchIntent(text)).toEqual({ intent: 'list_cards' });
    }
    expect(matchIntent('meus cartoes do nubank')).toBeNull();
  });
});
