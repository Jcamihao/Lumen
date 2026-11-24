import {
  CARD_NAME_MAX,
  CARD_WRITE_REPLIES,
  cardCreateDraftText,
  cardCreatedText,
  nameTakenBy,
  parseCardCreate,
  parseCardRename,
  parseClosingDayAnswer,
} from './card-write';

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

describe('Criar cartao: leitura do comando e da resposta (9b-3b)', () => {
  it('nome sozinho: sem dias, o motor pergunta o fechamento', () => {
    expect(parseCardCreate('Nubank')).toEqual({ ok: true, name: 'Nubank', closingDay: null, dueDay: null });
  });

  it('fechamento e vencimento na frase, com e sem a palavra "dia"', () => {
    expect(parseCardCreate('Nubank fecha dia 10')).toEqual({ ok: true, name: 'Nubank', closingDay: 10, dueDay: null });
    expect(parseCardCreate('Nubank fechamento 10')).toEqual({ ok: true, name: 'Nubank', closingDay: 10, dueDay: null });
    expect(parseCardCreate('Nubank vence dia 17')).toEqual({ ok: true, name: 'Nubank', closingDay: null, dueDay: 17 });
    expect(parseCardCreate('Nubank fecha dia 10 vence dia 17')).toEqual({ ok: true, name: 'Nubank', closingDay: 10, dueDay: 17 });
    expect(parseCardCreate('Nubank vencimento 3 fechamento 25')).toEqual({ ok: true, name: 'Nubank', closingDay: 25, dueDay: 3 });
  });

  it('dia 1 e dia 31 sao validos na frase (bordas)', () => {
    expect(parseCardCreate('Nubank fecha dia 31')).toEqual({ ok: true, name: 'Nubank', closingDay: 31, dueDay: null });
    expect(parseCardCreate('Nubank vence dia 1')).toEqual({ ok: true, name: 'Nubank', closingDay: null, dueDay: 1 });
  });

  it('nome com mais de uma palavra fica inteiro antes da palavra de dia', () => {
    expect(parseCardCreate('Nubank Black fecha dia 10')).toMatchObject({ ok: true, name: 'Nubank Black', closingDay: 10 });
  });

  it('sem nome, recusa pedindo o nome', () => {
    expect(parseCardCreate('')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createNeedsName });
    expect(parseCardCreate('fecha dia 10')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createNeedsName });
  });

  it('nome de exatos 40 caracteres e aceito (borda) e dia com zero a esquerda ou 3 digitos recusa', () => {
    expect(parseCardCreate(`${'x'.repeat(40)} fecha dia 10`)).toEqual({ ok: true, name: 'x'.repeat(40), closingDay: 10, dueDay: null });
    expect(parseCardCreate('Nubank fecha dia 007')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createBadDay('fechamento') });
    expect(parseCardCreate('Nubank vence dia 017')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createBadDay('vencimento') });
  });

  it('nome com mais de 40 caracteres recusa', () => {
    expect(parseCardCreate(`${'x'.repeat(41)} fecha dia 10`)).toEqual({ ok: false, text: CARD_WRITE_REPLIES.nameLength });
  });

  it.each([
    ['Nubank fecha dia 0', 'fechamento'],
    ['Nubank fecha dia 32', 'fechamento'],
    ['Nubank fecha', 'fechamento'],
    ['Nubank fecha dia abc', 'fechamento'],
    ['Nubank vence dia 40', 'vencimento'],
    ['Nubank vence dia 1.5', 'vencimento'],
  ])('"%s" recusa sem rascunho (dia fora de 1 a 31)', (body, label) => {
    expect(parseCardCreate(body)).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createBadDay(label as 'fechamento' | 'vencimento') });
  });

  it('palavra desconhecida depois do nome recusa sem rascunho', () => {
    expect(parseCardCreate('Nubank fecha dia 10 bonus')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createUnknownWord });
  });

  it('a mesma palavra repetida (fecha duas vezes) recusa sem rascunho', () => {
    expect(parseCardCreate('Nubank fecha dia 10 fecha dia 12')).toEqual({ ok: false, text: CARD_WRITE_REPLIES.createUnknownWord });
  });

  it('resposta da pergunta: so o numero do dia, com ou sem "dia"', () => {
    expect(parseClosingDayAnswer('10')).toBe(10);
    expect(parseClosingDayAnswer('dia 10')).toBe(10);
    expect(parseClosingDayAnswer('Dia 1')).toBe(1);
    expect(parseClosingDayAnswer('31')).toBe(31);
    expect(parseClosingDayAnswer('10.')).toBe(10);
  });

  it.each(['0', '32', '100', 'abc', '', 'dia', '10 e 12', '1.5', '-3'])('resposta "%s" nao e dia valido', (value) => {
    expect(parseClosingDayAnswer(value)).toBeNull();
  });

  it('textos do rascunho e do recibo', () => {
    expect(cardCreateDraftText({ name: 'Nubank', closingDay: 10, dueDay: 17 })).toBe(
      'Criar o cartão Nubank. Fecha: dia 10. Vence: dia 17. Não será o cartão padrão.',
    );
    expect(cardCreateDraftText({ name: 'Nubank', closingDay: null, dueDay: null })).toBe(
      'Criar o cartão Nubank. Fecha: a informar. Vence: sem vencimento. Não será o cartão padrão.',
    );
    expect(cardCreatedText({ name: 'Nubank', closingDay: 10, dueDay: null })).toBe('Cartão Nubank criado, fecha dia 10.');
    expect(cardCreatedText({ name: 'Nubank', closingDay: 10, dueDay: 17 })).toBe('Cartão Nubank criado, fecha dia 10, vence dia 17.');
  });
});
