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
    expect(matchIntent('limite do nubank estourou')).toBeNull();
    expect(matchIntent('limite do nubank')).toBeNull(); // forma curta sem valor nao e escrita
  });

  it('nome generico nao vale: "limite do cartao 2000" continua leitura', () => {
    expect(matchIntent('limite do cartao 2000')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('limite do credito 2000')).toBeNull(); // como antes da 8d: nao e frase de leitura
  });
});
