import { matchIntent } from './intent.matcher';

describe('matcher do editar/apagar metas e reservas (8b, secao 3)', () => {
  it('substantivo escolhe o alvo', () => {
    expect(matchIntent('apagar meta viagem')).toEqual({ intent: 'delete_goal', body: 'viagem' });
    expect(matchIntent('editar cofrinho praia')).toEqual({ intent: 'edit_goal', body: 'praia' });
    expect(matchIntent('excluir metas casa')).toEqual({ intent: 'delete_goal', body: 'casa' });
    expect(matchIntent('apagar reserva gasolina')).toEqual({ intent: 'delete_envelope', body: 'gasolina' });
    expect(matchIntent('corrigir envelope lazer')).toEqual({ intent: 'edit_envelope', body: 'lazer' });
    expect(matchIntent('alterar reservas')).toEqual({ intent: 'edit_envelope', body: '' });
  });

  it('artigos e poses nao entram no termo', () => {
    expect(matchIntent('editar a minha meta viagem')).toEqual({ intent: 'edit_goal', body: 'viagem' });
    expect(matchIntent('apagar o lançamento padaria')).toEqual({ intent: 'delete_transaction', body: 'padaria' });
  });

  it('sem substantivo continua sendo lançamento (8a)', () => {
    expect(matchIntent('apagar mercado')).toEqual({ intent: 'delete_transaction', body: 'mercado' });
    expect(matchIntent('editar meta')).toEqual({ intent: 'edit_goal', body: '' });
    expect(matchIntent('apagar conta')).toEqual({ intent: 'delete_transaction', body: '' });
  });

  it('regras do 8a seguem valendo: comando curto e sem "?", 7 palavras nao casa', () => {
    expect(matchIntent('apagar meta viagem ao japão?')).toBeNull();
    expect(matchIntent('editar a meta de viagem ao japão agora')).toBeNull();
    expect(matchIntent('apagar meta viagem ao japão')).toEqual({ intent: 'delete_goal', body: 'viagem ao japão' });
  });

  it('leitura "metas" e "reservas" nao vira comando de mudanca', () => {
    expect(matchIntent('minhas metas')).toEqual({ intent: 'goals' });
    expect(matchIntent('reservas')).toEqual({ intent: 'envelopes' });
  });
});
