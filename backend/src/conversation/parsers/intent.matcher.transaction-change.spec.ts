import { matchIntent } from './intent.matcher';

describe('matchIntent: editar e apagar lancamento (8a, secao 2)', () => {
  it.each([
    ['apagar mercado', { intent: 'delete_transaction', body: 'mercado' }],
    ['excluir lançamento 50', { intent: 'delete_transaction', body: '50' }],
    ['remover 32,90 farmacia', { intent: 'delete_transaction', body: '32,90 farmacia' }],
    ['APAGAR Mercado', { intent: 'delete_transaction', body: 'Mercado' }],
    ['apagar', { intent: 'delete_transaction', body: '' }],
    ['apagar conta', { intent: 'delete_transaction', body: '' }],
    ['editar mercado', { intent: 'edit_transaction', body: 'mercado' }],
    ['corrigir mercado', { intent: 'edit_transaction', body: 'mercado' }],
    ['alterar lançamento padaria', { intent: 'edit_transaction', body: 'padaria' }],
  ])('casa "%s"', (text, expected) => {
    expect(matchIntent(text)).toEqual(expected);
  });

  it.each([
    'apagar tudo o que eu lancei no mes passado e ver se sobra algo',
    'apagar mercado?',
    'corrigir isso?',
  ])('frase longa ou com "?" nao casa (conversa livre): "%s"', (text) => {
    expect(matchIntent(text)).toBeNull();
  });

  it('nao colide com cancelar nem com as metas e reservas existentes', () => {
    expect(matchIntent('cancelar')).toBeNull();
    expect(matchIntent('criar meta viagem 2000')).toEqual({ intent: 'create_goal', body: 'viagem 2000' });
    expect(matchIntent('criar reserva mercado 300')).toEqual({ intent: 'create_envelope', body: 'mercado 300' });
  });
});
