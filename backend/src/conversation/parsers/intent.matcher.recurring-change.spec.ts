import { matchIntent } from './intent.matcher';

describe('matcher do editar/apagar contas fixas e parcelados (8c, secao 3)', () => {
  it('substantivos novos escolhem o alvo', () => {
    expect(matchIntent('apagar conta fixa netflix')).toEqual({ intent: 'delete_recurring', body: 'netflix' });
    expect(matchIntent('excluir contas fixas academia')).toEqual({ intent: 'delete_recurring', body: 'academia' });
    expect(matchIntent('editar fixa netflix')).toEqual({ intent: 'edit_recurring', body: 'netflix' });
    expect(matchIntent('apagar parcelado tv')).toEqual({ intent: 'delete_installment', body: 'tv' });
    expect(matchIntent('excluir parcelados iphone 15')).toEqual({ intent: 'delete_installment', body: 'iphone 15' });
    expect(matchIntent('corrigir compras parceladas geladeira')).toEqual({ intent: 'edit_installment', body: 'geladeira' });
  });

  it('artigos e poses nao entram no termo', () => {
    expect(matchIntent('apagar a minha conta fixa netflix')).toEqual({ intent: 'delete_recurring', body: 'netflix' });
    expect(matchIntent('editar o parcelado tv')).toEqual({ intent: 'edit_installment', body: 'tv' });
  });

  it('D1 do dono: "conta" sozinho continua sendo lancamento', () => {
    expect(matchIntent('apagar conta')).toEqual({ intent: 'delete_transaction', body: '' });
    expect(matchIntent('editar minha conta')).toEqual({ intent: 'edit_transaction', body: '' });
    expect(matchIntent('apagar conta de luz')).toEqual({ intent: 'delete_transaction', body: 'conta de luz' });
  });

  it('leitura e criacao seguem em outro lugar', () => {
    expect(matchIntent('minhas parcelas')).toEqual({ intent: 'installments' });
    expect(matchIntent('criar conta fixa netflix 50')).toEqual({ intent: 'create_recurring', body: 'netflix 50' });
    expect(matchIntent('criar parcelado tv')).toEqual({ intent: 'create_installment', body: 'tv' });
  });

  it('travas do 8a valem para os substantivos novos', () => {
    expect(matchIntent('apagar conta fixa netflix todo mes?')).toBeNull();
    expect(matchIntent('apagar conta fixa netflix da amazon agora')).toBeNull();
    expect(matchIntent('apagar conta fixa netflix da amazon')).toEqual({ intent: 'delete_recurring', body: 'netflix da amazon' });
  });

  it('substantivos do 8b seguem roteando para la', () => {
    expect(matchIntent('apagar meta viagem')).toEqual({ intent: 'delete_goal', body: 'viagem' });
    expect(matchIntent('editar reserva lazer')).toEqual({ intent: 'edit_envelope', body: 'lazer' });
  });
});
