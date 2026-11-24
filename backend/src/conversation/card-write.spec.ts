import { CARD_NAME_MAX, CARD_WRITE_REPLIES, nameTakenBy, parseCardRename } from './card-write';

describe('Renomear cartao: leitura do comando (9b-3, secao 7)', () => {
  it('separa o termo do novo nome no primeiro "para"', () => {
    expect(parseCardRename('Principal para Nubank')).toEqual({ ok: true, term: 'Principal', newName: 'Nubank' });
  });

  it('tira os conectores e a palavra cartao da frente do termo', () => {
    expect(parseCardRename('cartao Principal para Nubank')).toMatchObject({ ok: true, term: 'Principal' });
    expect(parseCardRename('do cartao Principal para Nubank')).toMatchObject({ ok: true, term: 'Principal' });
    expect(parseCardRename('da Principal para Nubank')).toMatchObject({ ok: true, term: 'Principal' });
  });

  it('aceita espacos sobrando e preserva o nome novo como foi digitado', () => {
    expect(parseCardRename('  Principal   para   Nubank Black  ')).toEqual({ ok: true, term: 'Principal', newName: 'Nubank Black' });
  });

  it('usa o primeiro "para" como separador: o resto e o nome novo', () => {
    expect(parseCardRename('Principal para Para Viagem')).toEqual({ ok: true, term: 'Principal', newName: 'Para Viagem' });
  });

  it('sem "para" pede o novo nome', () => {
    expect(parseCardRename('Principal')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.renameNeedsName });
  });

  it('sem termo antes do "para" pede qual cartao', () => {
    expect(parseCardRename('para Nubank')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.renameNeedsTerm });
    expect(parseCardRename('cartao para Nubank')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.renameNeedsTerm });
  });

  it('sem nome novo depois do "para" pede o nome', () => {
    expect(parseCardRename('Principal para ')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.renameNeedsName });
    expect(parseCardRename('Principal para')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.renameNeedsName });
  });

  it('nome novo com 40 caracteres passa e com 41 e recusado (mesmo limite do DTO)', () => {
    const ok = 'a'.repeat(CARD_NAME_MAX);
    const tooLong = 'a'.repeat(CARD_NAME_MAX + 1);
    expect(parseCardRename(`Principal para ${ok}`)).toMatchObject({ ok: true, newName: ok });
    expect(parseCardRename(`Principal para ${tooLong}`)).toEqual({ ok: false, text: CARD_WRITE_REPLIES.nameLength });
  });
});

describe('nameTakenBy (mesma regra da API: sem diferenciar maiuscula, entre ativos)', () => {
  const cards = [
    { id: 'c1', name: 'Nubank' },
    { id: 'c2', name: 'Itaú' },
  ];

  it('acha outro cartao com o mesmo nome sem caixa', () => {
    expect(nameTakenBy(cards, 'nubank', 'c2')).toBe(true);
    expect(nameTakenBy(cards, 'ITAÚ', 'c1')).toBe(true);
  });

  it('o proprio cartao nao conta (trocar so a caixa do nome e permitido)', () => {
    expect(nameTakenBy(cards, 'NUBANK', 'c1')).toBe(false);
  });

  it('acha o nome que so difere no acento ou na pontuacao final (igualdade normalizada da busca do chat)', () => {
    expect(nameTakenBy(cards, 'Itau', 'c1')).toBe(true);
    expect(nameTakenBy(cards, 'nubánk', 'c2')).toBe(true);
    expect(nameTakenBy(cards, 'Nubank!', 'c2')).toBe(true);
  });

  it('nome so de pontuacao nao conflita por chave vazia', () => {
    expect(nameTakenBy([{ id: 'c1', name: '???' }], '!!!', 'c2')).toBe(false);
  });

  it('nome livre nao conflita', () => {
    expect(nameTakenBy(cards, 'Roxinho', 'c1')).toBe(false);
  });
});
