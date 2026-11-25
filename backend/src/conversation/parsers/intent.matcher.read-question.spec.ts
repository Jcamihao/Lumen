import { matchIntent } from './intent.matcher';
import { matchReadQuestion } from './read-question';

const POSITIVES: Array<[string, object]> = [
  // balance
  ['como está o meu saldo?', { intent: 'balance' }],
  ['como esta meu saldo', { intent: 'balance' }],
  ['qual é o meu saldo?', { intent: 'balance' }],
  ['qual meu saldo hoje', { intent: 'balance' }],
  ['qual o saldo atual', { intent: 'balance' }],
  ['me mostra o saldo', { intent: 'balance' }],
  ['me diz o saldo', { intent: 'balance' }],
  ['quero ver meu saldo', { intent: 'balance' }],
  ['quero saber meu saldo', { intent: 'balance' }],
  ['pode me dizer o saldo?', { intent: 'balance' }],
  ['consultar saldo', { intent: 'balance' }],
  ['ver saldo', { intent: 'balance' }],
  ['meu saldo', { intent: 'balance' }],
  ['saldo atual', { intent: 'balance' }],
  ['quanto eu tenho?', { intent: 'balance' }],
  ['quanto tenho de saldo', { intent: 'balance' }],
  ['quanto tenho na conta', { intent: 'balance' }],
  ['quanto tenho em conta', { intent: 'balance' }],
  ['quanto eu tenho hoje', { intent: 'balance' }],
  ['tenho quanto?', { intent: 'balance' }],
  ['to com quanto?', { intent: 'balance' }],
  ['estou com quanto de saldo', { intent: 'balance' }],
  ['quanto tem na minha conta', { intent: 'balance' }],
  ['como estou de saldo', { intent: 'balance' }],
  ['quanto dinheiro eu tenho', { intent: 'balance' }],
  ['quanto de dinheiro tenho', { intent: 'balance' }],
  ['quanto sobrou', { intent: 'balance' }],
  ['quanto me sobrou', { intent: 'balance' }],
  ['quanto sobrou esse mes', { intent: 'balance' }],
  ['quanto tenho disponivel', { intent: 'balance' }],
  ['qual meu saldo disponivel', { intent: 'balance' }],
  ['quero saber quanto tenho de saldo', { intent: 'balance' }],
  // month_summary
  ['como foi meu mês?', { intent: 'month_summary' }],
  ['como está meu mês?', { intent: 'month_summary' }],
  ['como estou esse mês?', { intent: 'month_summary' }],
  ['como estão minhas finanças?', { intent: 'month_summary' }],
  ['como estao as minhas financas', { intent: 'month_summary' }],
  ['me dá um resumo', { intent: 'month_summary' }],
  ['me da um resumo do mes', { intent: 'month_summary' }],
  ['quero um resumo', { intent: 'month_summary' }],
  ['qual o resumo do mês', { intent: 'month_summary' }],
  ['resumo financeiro', { intent: 'month_summary' }],
  ['como estou financeiramente', { intent: 'month_summary' }],
  ['como vai meu mes', { intent: 'month_summary' }],
  // spend_total
  ['quanto gastei?', { intent: 'spend_total' }],
  ['quanto eu gastei?', { intent: 'spend_total' }],
  ['quanto já gastei?', { intent: 'spend_total' }],
  ['quanto gastei esse mês?', { intent: 'spend_total' }],
  ['quanto gastei hoje', { intent: 'spend_total' }],
  ['quanto estou gastando', { intent: 'spend_total' }],
  ['quanto eu estou gastando esse mês', { intent: 'spend_total' }],
  ['quanto foi gasto esse mes', { intent: 'spend_total' }],
  ['qual meu gasto total', { intent: 'spend_total' }],
  ['qual o total de gastos', { intent: 'spend_total' }],
  ['meus gastos do mês', { intent: 'spend_total' }],
  ['meus gastos', { intent: 'spend_total' }],
  ['total de gastos', { intent: 'spend_total' }],
  ['total gasto', { intent: 'spend_total' }],
  ['como estão meus gastos', { intent: 'spend_total' }],
  ['quanto gastei no total', { intent: 'spend_total' }],
  // upcoming_dues
  ['o que tenho pra pagar?', { intent: 'upcoming_dues' }],
  ['o que eu tenho que pagar', { intent: 'upcoming_dues' }],
  ['o que falta pagar', { intent: 'upcoming_dues' }],
  ['o que tenho a pagar', { intent: 'upcoming_dues' }],
  ['quais contas vencem', { intent: 'upcoming_dues' }],
  ['quais contas vencem essa semana', { intent: 'upcoming_dues' }],
  ['quais são os próximos vencimentos', { intent: 'upcoming_dues' }],
  ['quais minhas contas a pagar', { intent: 'upcoming_dues' }],
  ['contas a pagar', { intent: 'upcoming_dues' }],
  ['quando vence minha proxima conta', { intent: 'upcoming_dues' }],
  ['tenho alguma conta pra pagar?', { intent: 'upcoming_dues' }],
  ['tem conta vencendo?', { intent: 'upcoming_dues' }],
  ['o que vai vencer', { intent: 'upcoming_dues' }],
  // installments
  ['quais são minhas parcelas?', { intent: 'installments' }],
  ['quais minhas parcelas', { intent: 'installments' }],
  ['como estão minhas parcelas?', { intent: 'installments' }],
  ['quantas parcelas eu tenho?', { intent: 'installments' }],
  ['tenho alguma parcela?', { intent: 'installments' }],
  ['quais compras parceladas eu tenho', { intent: 'installments' }],
  ['me mostra minhas parcelas', { intent: 'installments' }],
  // fixed_bills
  ['quais são minhas contas fixas?', { intent: 'fixed_bills' }],
  ['quais minhas contas fixas', { intent: 'fixed_bills' }],
  ['como estão minhas contas fixas', { intent: 'fixed_bills' }],
  ['quais despesas fixas eu tenho', { intent: 'fixed_bills' }],
  ['me mostra minhas contas fixas', { intent: 'fixed_bills' }],
  ['quanto pago de conta fixa', { intent: 'fixed_bills' }],
  // goals
  ['como estão minhas metas?', { intent: 'goals' }],
  ['como andam minhas metas', { intent: 'goals' }],
  ['quais são minhas metas?', { intent: 'goals' }],
  ['quais minhas metas', { intent: 'goals' }],
  ['me mostra minhas metas', { intent: 'goals' }],
  ['quanto falta pras minhas metas', { intent: 'goals' }],
  // envelopes
  ['como estão minhas reservas?', { intent: 'envelopes' }],
  ['quais são minhas reservas', { intent: 'envelopes' }],
  ['quanto eu tenho guardado', { intent: 'envelopes' }],
  ['quanto eu tenho de reserva', { intent: 'envelopes' }],
  ['me mostra minhas reservas', { intent: 'envelopes' }],
  // list_cards
  ['quais são meus cartões?', { intent: 'list_cards' }],
  ['quais cartoes eu tenho', { intent: 'list_cards' }],
  ['que cartoes eu tenho', { intent: 'list_cards' }],
  ['me mostra meus cartoes', { intent: 'list_cards' }],
  ['quantos cartoes eu tenho', { intent: 'list_cards' }],
  ['como estão meus cartoes', { intent: 'list_cards' }],
  // credit_card (cartao padrao)
  ['como está meu cartão?', { intent: 'credit_card' }],
  ['como esta o cartao', { intent: 'credit_card' }],
  ['qual meu limite?', { intent: 'credit_card' }],
  ['qual o limite do cartão?', { intent: 'credit_card' }],
  ['quanto de limite eu tenho', { intent: 'credit_card' }],
  ['quanto sobrou no cartão', { intent: 'credit_card' }],
  ['qual a fatura do cartão', { intent: 'credit_card' }],
  ['qual minha fatura', { intent: 'credit_card' }],
  ['quanto está minha fatura', { intent: 'credit_card' }],
  ['como está minha fatura', { intent: 'credit_card' }],
  ['quanto devo no cartão', { intent: 'credit_card' }],
  ['quanto gastei no cartão', { intent: 'credit_card' }],
  // credit_card com nome
  ['como está a fatura do Nubank?', { intent: 'credit_card', cardTerm: 'Nubank', loose: true }],
  ['qual a fatura do Nubank', { intent: 'credit_card', cardTerm: 'Nubank', loose: true }],
  ['qual o limite do Nubank?', { intent: 'credit_card', cardTerm: 'Nubank', loose: true }],
  ['como está meu cartão Nubank?', { intent: 'credit_card', cardTerm: 'Nubank' }],
  ['como esta o cartao do Nubank', { intent: 'credit_card', cardTerm: 'Nubank' }],
];

/** Variantes da mesma pergunta: com "?", sem acento e em caixa alta. A resposta tem de ser igual. */
function variants(phrase: string): string[] {
  const noAccent = phrase.normalize('NFD').replace(/\p{M}/gu, '');
  const capitalized = noAccent.charAt(0).toUpperCase() + noAccent.slice(1);
  return [phrase, `${phrase}?`, capitalized];
}

describe('leitura em linguagem natural (perguntas e pedidos)', () => {
  it.each(POSITIVES.flatMap(([phrase, expected]) => variants(phrase).map((text) => [text, expected])))(
    'casa: "%s"',
    (text, expected) => {
      expect(matchIntent(text as string)).toEqual(expected);
    },
  );

  it.each(POSITIVES)('com "?" e sem "?" dao o mesmo resultado: "%s"', (phrase) => {
    const bare = phrase.replace(/\?$/, '');
    expect(matchIntent(bare)).toEqual(matchIntent(`${bare}?`));
  });

  it('"quanto devo no Nubank" casa sem "?"; com "?" segue a regra de "quanto sobrou no Nubank?" (ver duvidas)', () => {
    expect(matchIntent('quanto devo no Nubank')).toEqual({ intent: 'credit_card', cardTerm: 'Nubank', loose: true });
    expect(matchIntent('quanto devo no Nubank?')).toBeNull();
  });

  it.each([
    'o saldo da minha tia deve ser alto?',
    'vale a pena guardar saldo?',
    'como faço para aumentar meu saldo',
    'por que meu saldo caiu?',
    'como está o saldo da conta do meu pai?',
    'quanto custa um iphone',
    'como está o clima hoje',
    'qual o melhor cartão para viajar',
    'minhas metas estão boas?',
    'parcelas do carro vale a pena',
    'parcelas do carro: vale a pena?',
    'como estou hoje?',
    'como está',
    'oi',
    'bom dia',
    'quanto sobrou no Nubank?',
    'limite do nubank?',
    'quanto devo no Nubank?',
  ])('nao casa: "%s"', (text) => {
    expect(matchIntent(text)).toBeNull();
  });

  it('leitor direto: frases com prefixo "quanto tenho" ja capturado pelo matcher antigo', () => {
    const text = 'quanto tenho que guardar por mês para comprar um carro de 50 mil';
    const tokens = text.split(/\s+/);
    const words = tokens.map((token) => token.toLowerCase());
    expect(matchReadQuestion(text, tokens, words)).toBeNull();
  });

  it('frases de escrita e de leitura antigas mantem a intencao', () => {
    expect(matchIntent('quanto gastei com mercado')).toEqual({ intent: 'spend_by_category', categoryQuery: 'mercado' });
    expect(matchIntent('gastei 50 mercado')).toEqual({ intent: 'create_expense', body: '50 mercado' });
    expect(matchIntent('saldo?')).toEqual({ intent: 'balance' });
    expect(matchIntent('limite do cartão')).toEqual({ intent: 'credit_card' });
    expect(matchIntent('meus cartoes do nubank')).toBeNull();
  });

  it('valor na frase nunca vira leitura natural', () => {
    expect(matchIntent('quanto eu tenho 50')).toBeNull();
    expect(matchIntent('como está meu cartão 2000')).toBeNull();
  });

  it('mais de 12 palavras vai ao Selah; 12 casa', () => {
    expect(matchIntent('me mostra por favor o meu saldo atual de hoje agora pode ai la')).toBeNull();
    expect(matchIntent('pode me dizer o meu saldo atual de hoje por favor agora')).toEqual({ intent: 'balance' });
  });
});

describe('limites de leitura por cartao e de frase', () => {
  it.each([
    'quanto custa o cartao Nubank',
    'como esta meu cartao esse mes',
    'fatura nubank',
    'quanto devo no banco nacional bahia sul norte',
    'quanto gastei no mercado esse mes com meu dinheiro',
    'quanto sobrou no',
    'como esta a fatura do',
    'qual o limite do',
  ])('nao casa: "%s"', (text) => {
    expect(matchIntent(text)).toBeNull();
  });

  it('nome de cartao com ate 4 palavras casa sem a palavra cartao', () => {
    expect(matchIntent('quanto devo no banco nacional bahia')).toEqual({
      intent: 'credit_card',
      cardTerm: 'banco nacional bahia',
      loose: true,
    });
  });
});
