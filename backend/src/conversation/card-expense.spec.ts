import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CARD_ARCHIVED_MESSAGE } from '../credit-cards/card-link';
import { CARD_EXPENSE_REPLIES, findCardPhrase, removeTokenRange } from './card-expense';
import { TransactionType } from '@prisma/client';
import { ConversationService } from './conversation.service';
import { ConversationInput } from './conversation.types';
import { doneText } from './replies';

type Deps = ConstructorParameters<typeof ConversationService>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const T0 = new Date('2026-11-15T12:00:00.000Z');
const clone = <T,>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && 'in' in expected) return (expected.in as unknown[]).includes(row[key]);
    return row[key] === expected;
  });
}

const CARDS: Row[] = [
  { id: 'cr-nubank', userId: 'A', name: 'Nubank', isDefault: true, archivedAt: null },
  { id: 'cr-itau', userId: 'A', name: 'Itaú', isDefault: false, archivedAt: null },
  { id: 'cr-itau-b', userId: 'B', name: 'Itaú', isDefault: true, archivedAt: null },
  { id: 'cr-bradesco-b', userId: 'B', name: 'Bradesco', isDefault: false, archivedAt: null },
];

function buildService(initialCards: Row[] = CARDS) {
  const cards = initialCards.map((card) => ({ ...card }));
  const sessions: Row[] = [];
  const events: Row[] = [];
  const categories: Row[] = [
    { id: 'cat-mercado', userId: 'A', name: 'Mercado', type: 'EXPENSE' },
    { id: 'cat-mercado-b', userId: 'B', name: 'Mercado', type: 'EXPENSE' },
  ];

  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async () => ({ timezone: 'America/Sao_Paulo' })) },
    creditCard: {
      // Honra o orderBy do servico (padrao primeiro, depois nome), como o banco.
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        clone(
          cards
            .filter((row) => matches(row, where))
            .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || String(a.name).localeCompare(String(b.name))),
        ),
      ),
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(cards.find((row) => matches(row, where)) ?? null)),
    },
    financeCategory: {
      findMany: jest.fn(async ({ where }: { where: Row }) => clone(categories.filter((row) => matches(row, where)))),
      findFirst: jest.fn(async () => null),
    },
    conversationSession: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(sessions.find((row) => matches(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), version: 1, ...data };
        sessions.push(row);
        return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = sessions.length;
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (matches(sessions[index], where)) sessions.splice(index, 1);
        }
        return { count: before - sessions.length };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = sessions.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    conversationEvent: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), messageId: null, appliedKey: null, resultRef: null, ...data };
        events.push(row);
        return clone(row);
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const transactions = { create: jest.fn(async () => ({ id: 'tx-1' })) };
  const config = { get: jest.fn(() => 'off') };
  // Ordem do construtor: prisma, dashboard, creditCycle, transactions, recurring, installments, goals, envelopes, entitlements, config, assistant.
  const deps = [prisma, {}, {}, transactions, {}, {}, {}, {}, {}, config, {}];
  const service = new ConversationService(...(deps as unknown as Deps));
  let counter = 0;
  const send = (text: string, userId = 'A') => {
    counter += 1;
    const input: ConversationInput = { userId, channel: 'APP', messageId: `m${counter}`, text, receivedAt: T0 };
    return service.handleMessage(input);
  };
  return { send, sessions, transactions, cards };
}

describe('findCardPhrase (9b-1, parser puro)', () => {
  const cards = [
    { id: 'cr-nubank', name: 'Nubank' },
    { id: 'cr-itau', name: 'Itaú' },
    { id: 'cr-mp', name: 'Mercado Pago' },
  ];

  it('casa nome igual sem acento e caixa', () => {
    expect(findCardPhrase(['mercado', 'no', 'ITAU'], cards)).toEqual({ kind: 'card', card: cards[1], from: 1, to: 2 });
  });

  it('nome de duas palavras consome so o nome', () => {
    expect(findCardPhrase(['no', 'mercado', 'pago', 'padaria'], cards)).toEqual({ kind: 'card', card: cards[2], from: 0, to: 2 });
  });

  it('nome curto dentro da descricao nao leva o resto', () => {
    expect(findCardPhrase(['no', 'nubank', 'almoco'], cards)).toEqual({ kind: 'card', card: cards[0], from: 0, to: 1 });
  });

  it('conector sem nome de cartao nao casa (descricao segue como hoje)', () => {
    expect(findCardPhrase(['no', 'mercado'], cards)).toBeNull();
    expect(findCardPhrase(['nubank'], cards)).toBeNull();
  });

  it('"no credito" sem nome e pedido de escolha, nao cartao', () => {
    expect(findCardPhrase(['no', 'credito'], cards)).toEqual({ kind: 'credit', from: 0, to: 1 });
    expect(findCardPhrase(['mercado', 'no', 'cartao'], cards)).toEqual({ kind: 'credit', from: 1, to: 2 });
  });

  it('"no credito <palavra que nao e cartao>" vira creditDefault: so "no credito" sai do texto', () => {
    expect(findCardPhrase(['no', 'credito', 'padaria'], cards)).toEqual({ kind: 'creditDefault', from: 0, to: 1 });
    expect(findCardPhrase(['no', 'credito', 'farmacia', 'centro'], cards)).toEqual({ kind: 'creditDefault', from: 0, to: 1 });
  });

  it('"no credito" com nome casa o cartao e tira o trecho inteiro', () => {
    expect(findCardPhrase(['no', 'credito', 'nubank'], cards)).toEqual({ kind: 'card', card: cards[0], from: 0, to: 2 });
  });

  it('cartao explicito que nao existe vira notFound com o termo', () => {
    expect(findCardPhrase(['no', 'cartao', 'bradesco'], cards)).toEqual({ kind: 'notFound', term: 'bradesco', from: 0, to: 2 });
  });

  it('cartao explicito ambiguo vira ambiguous com as duas opcoes', () => {
    const gold = [
      { id: 'g1', name: 'Nubank Black' },
      { id: 'g2', name: 'Nubank Gold' },
    ];
    const found = findCardPhrase(['no', 'cartao', 'nubank'], gold);
    expect(found?.kind).toBe('ambiguous');
    expect(found && found.kind === 'ambiguous' ? found.hits.map((card) => card.id) : []).toEqual(['g1', 'g2']);
  });

  it('removeTokenRange tira o intervalo, incluindo as pontas', () => {
    expect(removeTokenRange(['a', 'no', 'nubank', 'b'], 1, 2)).toEqual(['a', 'b']);
  });

  it('escolha por numero usa a lista oferecida', () => {
    expect(CARD_EXPENSE_REPLIES.choose(['Nubank', 'Itaú'])).toBe('Em qual cartão? 1) Nubank 2) Itaú ou responda pelo nome.');
  });
});

describe('despesa no cartao pela conversa (9b-1)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('"no nubank" grava CREDIT com cardId e nome; a descricao nao leva o trecho', async () => {
    const { send, sessions } = buildService();
    const reply = await send('gastei 50 mercado no nubank');
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    expect(reply.text).toContain('Pagamento: crédito');
    expect(reply.text).toContain('Cartão: Nubank');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: 'CREDIT', cardId: 'cr-nubank', cardName: 'Nubank', description: 'mercado' });
  });

  it('"no mercado" nao casa cartao: continua descricao, sem forma de pagamento', async () => {
    const { send, sessions } = buildService();
    await send('gastei 50 no mercado');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: null, cardId: null, description: 'mercado' });
  });

  it('acento e caixa: "NO ITAU" casa Itaú', async () => {
    const { send, sessions } = buildService();
    await send('gastei 50 mercado NO ITAU');
    expect(sessions[0].draft).toMatchObject({ cardId: 'cr-itau', cardName: 'Itaú' });
  });

  it('cartao explicito inexistente: responde a lista e nao grava nada', async () => {
    const { send, sessions } = buildService();
    const reply = await send('gastei 50 mercado no cartao Bradesco');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toContain('Cartões: Nubank, Itaú');
    expect(sessions).toHaveLength(0);
  });

  it('cartao explicito ambiguo: pede o nome completo e nao grava nada', async () => {
    const { send, sessions } = buildService([
      { id: 'g1', userId: 'A', name: 'Nubank Black', isDefault: true, archivedAt: null },
      { id: 'g2', userId: 'A', name: 'Nubank Gold', isDefault: false, archivedAt: null },
    ]);
    const reply = await send('gastei 50 mercado no cartao nubank');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toContain('Mais de um cartão bate com "nubank"');
    expect(sessions).toHaveLength(0);
  });

  it('cartao arquivado nao e oferecido: "no itau" vira cartao inexistente', async () => {
    const { send, sessions } = buildService([
      { id: 'cr-nubank', userId: 'A', name: 'Nubank', isDefault: true, archivedAt: null },
      { id: 'cr-itau', userId: 'A', name: 'Itaú', isDefault: false, archivedAt: T0 },
    ]);
    const reply = await send('gastei 50 mercado no cartao itau');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toContain('Cartões: Nubank');
    expect(sessions).toHaveLength(0);
  });

  it('"credito" sem nome com um cartao usa ele e mostra o nome', async () => {
    const { send, sessions } = buildService([{ id: 'cr-nubank', userId: 'A', name: 'Nubank', isDefault: true, archivedAt: null }]);
    const reply = await send('gastei 50 mercado no credito');
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: 'CREDIT', cardId: 'cr-nubank', cardName: 'Nubank' });
  });

  it('"credito" sem nome com varios: mostra a lista e a resposta numerada escolhe', async () => {
    const { send, sessions } = buildService();
    const ask = await send('gastei 50 mercado no credito');
    expect(ask.kind).toBe('ASK_FIELD');
    expect(ask.text).toContain('Em qual cartão? 1) Nubank 2) Itaú');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: null, cardId: null, pendingField: 'card' });
    const chosen = await send('2');
    expect(chosen.kind).toBe('CONFIRM_DRAFT');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: 'CREDIT', cardId: 'cr-itau', cardName: 'Itaú', pendingField: null });
  });

  it('padrao trocado depois da lista: o numero vale na ordem em que a lista foi mostrada', async () => {
    const { send, sessions, cards } = buildService();
    await send('gastei 50 mercado no credito');
    // Itaú vira o padrao: na ordem do 8d a lista passaria a ser Itaú, Nubank.
    cards.find((card) => card.id === 'cr-nubank')!.isDefault = false;
    cards.find((card) => card.id === 'cr-itau')!.isDefault = true;
    await send('1');
    expect(sessions[0].draft).toMatchObject({ cardId: 'cr-nubank', cardName: 'Nubank', pendingField: null });
  });

  it('cartao oferecido arquivado depois da lista: a resposta nao e usada e a lista nova e mostrada', async () => {
    const { send, sessions, cards } = buildService([
      { id: 'c1', userId: 'A', name: 'Nubank', isDefault: true, archivedAt: null },
      { id: 'c2', userId: 'A', name: 'Itaú', isDefault: false, archivedAt: null },
      { id: 'c3', userId: 'A', name: 'Bradesco', isDefault: false, archivedAt: null },
    ]);
    await send('gastei 50 mercado no credito');
    cards.find((card) => card.id === 'c1')!.archivedAt = new Date();
    const refreshed = await send('1');
    expect(refreshed.kind).toBe('ASK_FIELD');
    expect(refreshed.text).toContain('Em qual cartão? 1) Bradesco 2) Itaú');
    expect(sessions[0].draft).toMatchObject({ cardId: null, pendingField: 'card' });
    await send('1');
    expect(sessions[0].draft).toMatchObject({ cardId: 'c3', cardName: 'Bradesco', pendingField: null });
  });

  it('"credito" sem nome: a escolha tambem aceita o nome do cartao', async () => {
    const { send, sessions } = buildService();
    await send('gastei 50 mercado no credito');
    await send('nubank');
    expect(sessions[0].draft).toMatchObject({ cardId: 'cr-nubank', paymentMethod: 'CREDIT' });
  });

  it('"credito" sem nome e sem valor: a pergunta da lista so vem depois do valor', async () => {
    const { send, sessions } = buildService();
    const first = await send('gastei mercado no credito');
    expect(first.text).not.toContain('Em qual cartão');
    const second = await send('30');
    expect(second.kind).toBe('ASK_FIELD');
    expect(second.text).toContain('Em qual cartão?');
    expect(sessions[0].draft).toMatchObject({ amountCents: 3000, pendingField: 'card' });
  });

  it('"no credito" sem nenhum cartao ativo: CREDIT sem cardId (conta no padrao), trecho sai do texto', async () => {
    const { send, sessions } = buildService([]);
    await send('gastei 50 mercado no credito');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: 'CREDIT', cardId: null, description: 'mercado' });
  });

  it('"no credito padaria" nao recusa: vira descricao com CREDIT sem cardId', async () => {
    const { send, sessions } = buildService();
    const reply = await send('gastei 50 no credito padaria');
    expect(reply.kind).not.toBe('ERROR');
    expect(sessions[0].draft).toMatchObject({ paymentMethod: 'CREDIT', cardId: null, description: 'padaria' });
  });

  it('"no credito padaria" confirmado grava CREDIT sem cardId (cartao padrao)', async () => {
    const { send, transactions } = buildService();
    await send('gastei 50 no credito padaria');
    await send('sem categoria');
    const done = await send('confirmar');
    expect(done.kind).toBe('DONE');
    const dto = (transactions.create.mock.calls as unknown as Array<[string, Row]>)[0][1];
    expect(dto).toMatchObject({ paymentMethod: 'CREDIT', description: 'padaria' });
    expect(dto.cardId).toBeUndefined();
  });

  it('"no cartao <inexistente>" continua recusando mesmo com "credito" na frase', async () => {
    const { send, sessions } = buildService();
    const reply = await send('gastei 50 no cartao bradesco');
    expect(reply.kind).toBe('ERROR');
    expect(sessions).toHaveLength(0);
  });

  it('receita nao usa cartao: "recebi 800 no nubank" segue sem cartao', async () => {
    const { send, sessions } = buildService();
    const reply = await send('recebi 800 no nubank');
    expect(reply.kind).not.toBe('ERROR');
    expect(sessions[0].draft).toMatchObject({ type: 'INCOME', paymentMethod: null });
    expect(sessions[0].draft.cardId ?? null).toBeNull();
  });

  it('confirmar grava pelo TransactionsService com cardId e o recibo mostra o cartao', async () => {
    const { send, transactions } = buildService();
    await send('gastei 50 mercado no nubank');
    const done = await send('confirmar');
    expect(done.kind).toBe('DONE');
    expect(done.text).toBe(doneText(TransactionType.EXPENSE, 5000, 'mercado', 'Nubank'));
    expect(transactions.create).toHaveBeenCalledWith('A', expect.objectContaining({ cardId: 'cr-nubank', paymentMethod: 'CREDIT' }));
  });

  it('cartao arquivado entre rascunho e confirmacao: recusa clara e nada gravado', async () => {
    const { send, transactions, cards } = buildService();
    await send('gastei 50 mercado no nubank');
    cards[0].archivedAt = T0;
    transactions.create.mockRejectedValueOnce(new BadRequestException(CARD_ARCHIVED_MESSAGE));
    const reply = await send('confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe(CARD_ARCHIVED_MESSAGE);
    expect(transactions.create).toHaveBeenCalledTimes(1);
  });

  it('isolamento A/B/C: cartao de B nunca casa nem aparece para A; C sem cartao segue como hoje', async () => {
    const { send, transactions } = buildService();

    const aNotFound = await send('gastei 50 no cartao bradesco', 'A');
    expect(aNotFound.kind).toBe('ERROR');
    expect(aNotFound.text).toContain('Cartões: Nubank, Itaú');
    expect(aNotFound.text).not.toContain('cr-bradesco-b');

    await send('gastei 50 mercado no itau', 'A');
    await send('confirmar', 'A');
    expect(transactions.create).toHaveBeenLastCalledWith('A', expect.objectContaining({ cardId: 'cr-itau' }));

    await send('gastei 50 mercado no itau', 'B');
    await send('confirmar', 'B');
    expect(transactions.create).toHaveBeenLastCalledWith('B', expect.objectContaining({ cardId: 'cr-itau-b' }));

    const { send: sendC, sessions: sessionsC } = buildService([]);
    await sendC('gastei 50 mercado no nubank', 'C');
    expect(sessionsC[0].draft).toMatchObject({ paymentMethod: null, cardId: null, description: 'mercado no nubank' });
  });
});
