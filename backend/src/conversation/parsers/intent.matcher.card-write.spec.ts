import { matchIntent } from './intent.matcher';

describe('Matcher: criar e renomear cartao (9b-3)', () => {
  it.each([
    ['criar cartao Nubank', 'Nubank'],
    ['novo cartao Nubank', 'Nubank'],
    ['adicionar cartao Nubank', 'Nubank'],
    ['cadastrar cartão Nubank', 'Nubank'],
  ])('"%s" vira criar cartao', (text, body) => {
    expect(matchIntent(text)).toEqual({ intent: 'create_card', body });
  });

  it.each([
    ['renomear cartao Principal para Nubank', 'Principal para Nubank'],
    ['renomear Principal para Nubank', 'Principal para Nubank'],
    ['mudar nome do cartao Principal para Nubank', 'cartao Principal para Nubank'],
  ])('"%s" vira renomear cartao', (text, body) => {
    expect(matchIntent(text)).toEqual({ intent: 'rename_card', body });
  });

  it.each([
    ['criar cartao Nubank fecha dia 10', 'Nubank fecha dia 10'],
    ['criar cartao Nubank fecha dia 10 vence dia 17', 'Nubank fecha dia 10 vence dia 17'],
    ['novo cartao Nubank fechamento 10', 'Nubank fechamento 10'],
    ['cadastrar cartao Nubank vence dia 17', 'Nubank vence dia 17'],
  ])('"%s" vira criar cartao com o trecho depois do nome (dias na frase)', (text, body) => {
    expect(matchIntent(text)).toEqual({ intent: 'create_card', body });
  });

  it('"criar cartao" sem nome vira criar cartao com corpo vazio (o motor pede o nome)', () => {
    expect(matchIntent('criar cartao')).toEqual({ intent: 'create_card', body: '' });
  });

  it('renomear sem "para" nao e comando de cartao (segue o caminho de hoje)', () => {
    expect(matchIntent('renomear cartao Principal')).toBeNull();
    expect(matchIntent('renomear Principal')).toBeNull();
  });

  it('renomear meta, reserva ou conta fixa nao e cartao', () => {
    expect(matchIntent('renomear meta Viagem para Ferias')?.intent).not.toBe('rename_card');
    expect(matchIntent('renomear reserva Lazer para Viagem')?.intent).not.toBe('rename_card');
    expect(matchIntent('renomear conta fixa Aluguel para Casa')?.intent).not.toBe('rename_card');
  });

  it('"mudar nome" sem a palavra cartao nao e comando de cartao', () => {
    expect(matchIntent('mudar nome do mercado para lazer')).toBeNull();
    expect(matchIntent('mudar nome da meta para Viagem')).toBeNull();
  });

  it('pergunta com "?" nao vira comando de cartao', () => {
    expect(matchIntent('criar cartao Nubank?')).toBeNull();
    expect(matchIntent('renomear cartao Principal para Nubank?')).toBeNull();
  });

  it('regressao: criar meta, limite e leitura de cartao continuam como antes', () => {
    expect(matchIntent('criar meta viagem')).toMatchObject({ intent: 'create_goal' });
    expect(matchIntent('limite do nubank 2000')).toMatchObject({ intent: 'set_credit_limit' });
    expect(matchIntent('cartao Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank' });
    expect(matchIntent('meus cartoes')).toEqual({ intent: 'list_cards' });
  });
});
