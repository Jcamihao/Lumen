import { randomUUID } from 'crypto';
import { ConversationService } from './conversation.service';
import { ConversationInput } from './conversation.types';

type Deps = ConstructorParameters<typeof ConversationService>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const T0 = new Date('2026-11-15T12:00:00.000Z');
const clone = <T,>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

/** Filtro do banco fake: igualdade, lista (in) e data a partir de (gte). */
function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('in' in expected) return (expected.in as unknown[]).includes(row[key]);
      if ('gte' in expected) return row[key] >= (expected.gte as Date);
    }
    return row[key] === expected;
  });
}

function txRow(overrides: Row): Row {
  return {
    type: 'EXPENSE',
    amount: '10.00',
    categoryId: null,
    category: null,
    recurringTransactionId: null,
    installmentPurchaseId: null,
    linkedGoalId: null,
    receiptScan: null,
    createdAt: new Date('2026-11-10T10:00:00.000Z'),
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

function buildDb(transactions: Row[]) {
  const sessions: Row[] = [];
  const events: Row[] = [];
  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async () => ({ timezone: 'America/Sao_Paulo' })) },
    conversationSession: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(sessions.find((row) => matchesWhere(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), version: 1, ...data };
        sessions.push(row);
        return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = sessions.length;
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (matchesWhere(sessions[index], where)) sessions.splice(index, 1);
        }
        return { count: before - sessions.length };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = sessions.filter((row) => matchesWhere(row, where));
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
    financeCategory: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    transaction: {
      findMany: jest.fn(async ({ where, orderBy, take }: { where: Row; orderBy?: unknown; take?: number }) => {
        let rows = transactions.filter((row) => matchesWhere(row, where));
        rows = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
        if (take !== undefined) rows = rows.slice(0, take);
        return clone(rows);
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(transactions.find((row) => matchesWhere(row, where)) ?? null)),
    },
  };
  return { prisma, sessions, events };
}

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const ROWS: Row[] = [
  txRow({ id: 't1', userId: 'A', description: 'Mercado do bairro', amount: '50.00', date: day('2026-11-14'), categoryId: 'cat-mercado', category: { name: 'Mercado' } }),
  txRow({ id: 't2', userId: 'A', description: 'Mercado grande', amount: '120.00', date: day('2026-11-12') }),
  txRow({ id: 't3', userId: 'A', description: 'Mercado conta fixa', amount: '30.00', date: day('2026-11-13'), recurringTransactionId: 'rec-1' }),
  txRow({ id: 't4', userId: 'B', description: 'Mercado de B', amount: '10.00', date: day('2026-11-13') }),
  txRow({ id: 't5', userId: 'A', description: 'Padaria antiga', amount: '9.00', date: day('2026-05-01') }),
];

function buildService(transactions: Row[]) {
  const db = buildDb(transactions);
  const deps = [db.prisma, {}, {}, { create: jest.fn() }, {}, {}, {}, {}, {}, { get: jest.fn(() => true) }];
  const service = new ConversationService(...(deps as unknown as Deps));
  let counter = 0;
  const send = (userId: string, text: string) => {
    counter += 1;
    const input: ConversationInput = { userId, channel: 'APP', messageId: `m${counter}`, text, receivedAt: T0 };
    return service.handleMessage(input);
  };
  return { db, service, send: (text: string, userId = 'A') => send(userId, text) };
}

describe('editar/apagar: busca, lista e escolha (8a, secoes 3 e 4)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lista so os lancamentos manuais do proprio usuario, com numeracao e ordem', async () => {
    const { send, db } = buildService(ROWS);
    const reply = await send('apagar mercado');
    expect(reply.kind).toBe('ASK_FIELD');
    expect(reply.state).toBe('COLLECTING_FIELDS');
    expect(reply.text).toContain('1) 50,00 · Mercado do bairro · Mercado · 14/11');
    expect(reply.text).toContain('2) 120,00 · Mercado grande · 12/11');
    expect(reply.text).not.toContain('conta fixa');
    expect(reply.text).not.toContain('Mercado de B');
    expect(db.sessions[0].intent).toBe('delete_transaction');
    expect((db.sessions[0].draft as Row).candidateIds).toEqual(['t1', 't2']);
  });

  it('limita a lista a 5 itens', async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      txRow({ id: `m${index}`, userId: 'A', description: `Lote ${index}`, amount: '5.00', date: day(`2026-11-0${index + 1}`) }),
    );
    const { send, db } = buildService(many);
    await send('apagar lote');
    expect((db.sessions[0].draft as Row).candidateIds).toHaveLength(5);
  });

  it('so lancamentos nao elegiveis: mensagem de tela, sem sessao', async () => {
    const { send, db } = buildService(ROWS);
    const reply = await send('apagar conta fixa');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe('Esse lançamento veio de conta fixa, parcelado, meta ou nota; altere pela tela.');
    expect(db.sessions).toHaveLength(0);
  });

  it('nenhum resultado: INFO e sem sessao', async () => {
    const { send, db } = buildService(ROWS);
    const reply = await send('apagar xyz');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toBe('Não achei lançamento com isso nos últimos 180 dias.');
    expect(db.sessions).toHaveLength(0);
  });

  it('fora da janela de 180 dias nao aparece', async () => {
    const { send } = buildService(ROWS);
    const reply = await send('apagar padaria');
    expect(reply.kind).toBe('INFO');
  });

  it('valor sozinho busca pelo valor exato', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar 50');
    expect((db.sessions[0].draft as Row).candidateIds).toEqual(['t1']);
  });

  it('isolamento: a busca de B nao enxerga lancamento de A', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar mercado', 'B');
    expect((db.sessions[0].draft as Row).candidateIds).toEqual(['t4']);
    expect(db.prisma.transaction.findMany.mock.calls[0][0].where.userId).toBe('B');
  });

  it('escolher um numero da lista abre a previa de apagar com aviso', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar mercado');
    const reply = await send('2');
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    expect(reply.state).toBe('AWAITING_CONFIRMATION');
    expect(reply.text).toContain('Apagar: 120,00 · Mercado grande.');
    expect(reply.text).toContain('Isto apaga de vez e não dá para desfazer.');
    expect(reply.text).toContain('Para apagar, responda apagar.');
    expect(reply.quickReplies).toEqual(['apagar', 'cancelar']);
    expect((db.sessions[0].draft as Row).targetId).toBe('t2');
    expect((db.sessions[0].draft as Row).targetUpdatedAt).toBe(ROWS[1].updatedAt.toISOString());
  });

  it('numero fora da lista pede de novo e mantem a sessao', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar mercado');
    const before = db.sessions[0].version;
    const reply = await send('9');
    expect(reply.kind).toBe('ASK_FIELD');
    expect(reply.text).toContain('1) 50,00');
    expect(db.sessions[0].version).toBe(before);
  });

  it('apagar sem termo pergunta qual lancamento, e o texto seguinte e a busca', async () => {
    const { send, db } = buildService(ROWS);
    const first = await send('apagar');
    expect(first.kind).toBe('ASK_FIELD');
    expect(first.text).toBe('Qual lançamento? Diga parte da descrição, a categoria ou o valor. Ex.: apagar mercado');
    const second = await send('mercado');
    expect(second.kind).toBe('ASK_FIELD');
    expect((db.sessions[0].draft as Row).candidateIds).toEqual(['t1', 't2']);
  });
});
