import { matchIntent } from './intent.matcher';

describe('categorias por conversa (menu guiado, fatia 2)', () => {
  it.each([
    ['criar categoria', ''],
    ['criar categoria Pets', 'Pets'],
    ['nova categoria Pets', 'Pets'],
    ['adicionar categoria receita Freela', 'receita Freela'],
    ['criar uma categoria', ''],
  ])('"%s" cria categoria com corpo "%s"', (text, body) => {
    expect(matchIntent(text)).toEqual({ intent: 'create_category', body });
  });

  it.each([
    ['editar categoria', 'edit_category', ''],
    ['editar categoria Pets', 'edit_category', 'Pets'],
    ['alterar a categoria Pets', 'edit_category', 'Pets'],
    ['excluir categoria', 'delete_category', ''],
    ['excluir categoria Pets', 'delete_category', 'Pets'],
    ['apagar a categoria Pets', 'delete_category', 'Pets'],
    ['remover categorias', 'delete_category', ''],
  ])('"%s" vira %s', (text, intent, body) => {
    expect(matchIntent(text)).toEqual({ intent, body });
  });

  it.each(['minhas categorias', 'categorias', 'ver categorias'])('"%s" lista as categorias com os totais', (text) => {
    expect(matchIntent(text)).toEqual({ intent: 'categories' });
  });

  it('nao rouba outros comandos: editar/apagar lancamento e gasto por categoria seguem como antes', () => {
    expect(matchIntent('apagar mercado')).toEqual({ intent: 'delete_transaction', body: 'mercado' });
    expect(matchIntent('editar gasto mercado')).toMatchObject({ intent: 'edit_transaction' });
    expect(matchIntent('gastos com mercado')).toMatchObject({ intent: 'spend_by_category' });
    expect(matchIntent('criar cartão Nubank')).toMatchObject({ intent: 'create_card' });
  });

  it('pergunta com "?" nao cria categoria', () => {
    expect(matchIntent('como criar categoria?')).toBeNull();
  });
});
