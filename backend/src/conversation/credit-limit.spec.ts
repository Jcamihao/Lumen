import { cleanCardTerm, isClearLimitDraft, matchCardsByTerm, parseLimitBody, CL_REPLIES } from './credit-limit';

describe('corpo do definir limite com cartao (8d)', () => {
  it('so valor, ou nada, seguem o caminho de sempre', () => {
    expect(parseLimitBody('')).toEqual({ status: 'empty' });
    expect(parseLimitBody(' 2000 ')).toEqual({ status: 'amount', cents: 200_000 });
    expect(parseLimitBody('2 mil')).toEqual({ status: 'amount', cents: 200_000 });
  });

  it('nome e valor em qualquer ordem, com conector ou sem', () => {
    expect(parseLimitBody('nubank 2000')).toEqual({ status: 'card', term: 'nubank', cents: 200_000 });
    expect(parseLimitBody('do nubank 2 mil')).toEqual({ status: 'card', term: 'nubank', cents: 200_000 });
    expect(parseLimitBody('2000 do nubank')).toEqual({ status: 'card', term: 'nubank', cents: 200_000 });
    expect(parseLimitBody('cartao itau 1.500,50')).toEqual({ status: 'card', term: 'itau', cents: 150_050 });
  });

  it('so o nome: cartao escolhido, valor fica pendente', () => {
    expect(parseLimitBody('nubank')).toEqual({ status: 'card', term: 'nubank', cents: null });
    expect(parseLimitBody('do nubank')).toEqual({ status: 'card', term: 'nubank', cents: null });
  });

  it('"do credito" nao e nome de cartao: e o padrao com valor', () => {
    expect(parseLimitBody('do credito 2000')).toEqual({ status: 'amount', cents: 200_000 });
  });

  it('numero invalido devolve o erro do parser de valor, nao vira nome de cartao', () => {
    expect(parseLimitBody('0')).toEqual({ status: 'error', reason: 'ZERO' });
    expect(parseLimitBody('-50')).toEqual({ status: 'error', reason: 'NEGATIVE' });
    expect(parseLimitBody('nubank 0')).toEqual({ status: 'error', reason: 'ZERO' });
    expect(parseLimitBody('1,234.56')).toEqual({ status: 'error', reason: 'AMBIGUOUS' });
  });

  it('termo estranho sem numero continua termo (a busca e o cartao quem recusa)', () => {
    expect(parseLimitBody('nubank 2,,3')).toEqual({ status: 'card', term: 'nubank 2,,3', cents: null });
  });
});

describe('termo e busca de cartao (8d, busca como a do 8b)', () => {
  const cards = [
    { id: 'c1', name: 'Nubank' },
    { id: 'c2', name: 'Itaú Shop' },
    { id: 'c3', name: 'Nubank Empresa' },
  ];

  it('limpa conectores da frente, nao do meio', () => {
    expect(cleanCardTerm('do nubank')).toBe('nubank');
    expect(cleanCardTerm('cartao da caixa')).toBe('caixa');
    expect(cleanCardTerm('meu nubank')).toBe('nubank');
    expect(cleanCardTerm('nubank')).toBe('nubank');
    expect(cleanCardTerm('do')).toBe('');
  });

  it('igualdade vence a busca parcial', () => {
    expect(matchCardsByTerm(cards, 'nubank').map((c) => c.id)).toEqual(['c1']);
  });

  it('sem acento e sem caixa; parcial dos dois lados', () => {
    expect(matchCardsByTerm(cards, 'ITAU').map((c) => c.id)).toEqual(['c2']);
    expect(matchCardsByTerm(cards, 'shop').map((c) => c.id)).toEqual(['c2']);
    expect(matchCardsByTerm(cards, 'nubank empresa').map((c) => c.id)).toEqual(['c3']);
  });

  it('termo que pega dois cartoes devolve os dois (o motor pede nome completo)', () => {
    expect(matchCardsByTerm(cards, 'nub').map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(matchCardsByTerm(cards, 'nubank e itau').map((c) => c.id)).toEqual(['c1']); // termo longo contem o nome
  });

  it('termo vazio devolve todos (padrao e resolvido pelo motor)', () => {
    expect(matchCardsByTerm(cards, '')).toHaveLength(3);
  });
});

describe('rascunho de limpar teto (D3)', () => {
  it('so CREDIT_LIMIT com action clear', () => {
    expect(isClearLimitDraft({ kind: 'CREDIT_LIMIT', action: 'clear' })).toBe(true);
    expect(isClearLimitDraft({ kind: 'CREDIT_LIMIT' })).toBe(false);
    expect(isClearLimitDraft({ kind: 'CREDIT_LIMIT', action: 'set' })).toBe(false);
    expect(isClearLimitDraft({ kind: 'TRANSACTION_CHANGE', action: 'DELETE' })).toBe(false);
    expect(isClearLimitDraft(null)).toBe(false);
  });

  it('os textos conhecidos do chat', () => {
    expect(CL_REPLIES.cardNotFound('x', ['Nubank', 'Itaú'])).toContain('Cartões: Nubank, Itaú');
    expect(CL_REPLIES.clearNeedsWord).toBe('Para limpar o teto, responda limpar.');
  });
});
