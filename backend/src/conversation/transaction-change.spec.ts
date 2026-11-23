import { randomUUID } from 'crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
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

function buildDb(transactions: Row[], categories: Row[] = []) {
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
      findMany: jest.fn(async ({ where }: { where: Row }) => clone(categories.filter((row) => matchesWhere(row, where)))),
      findFirst: jest.fn(async () => null),
    },
    transaction: {
      findMany: jest.fn(async ({ where, orderBy, take }: { where: Row; orderBy?: unknown; take?: number }) => {
        let rows = transactions.filter((row) => matchesWhere(row, where));
        // Honra o orderBy pedido (o fake nao ordena por conta propria): mutar a ordem do servico tem de quebrar teste.
        const order = (orderBy as Array<Record<string, 'asc' | 'desc'>>) ?? [];
        rows = [...rows].sort((a, b) => {
          for (const clause of order) {
            const [key, dir] = Object.entries(clause)[0];
            const diff = (a[key] as Date).getTime() - (b[key] as Date).getTime();
            if (diff !== 0) return dir === 'desc' ? -diff : diff;
          }
          return 0;
        });
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

const CATEGORIES: Row[] = [
  { id: 'cat-mercado', userId: 'A', name: 'Mercado', type: 'EXPENSE' },
  { id: 'cat-padaria', userId: 'A', name: 'Padaria', type: 'EXPENSE' },
  { id: 'cat-pad-b', userId: 'A', name: 'Padaria Premium', type: 'EXPENSE' },
  { id: 'cat-salario', userId: 'A', name: 'Padaria de Receita', type: 'INCOME' },
];

function buildService(rows: Row[] = ROWS, writesEnabled = true) {
  const transactions = rows.map((row) => clone(row));
  const db = buildDb(transactions, CATEGORIES);
  const txService = {
    create: jest.fn(),
    update: jest.fn(async () => ({ id: 'unused' })),
    // Apaga de verdade no fake, como o TransactionsService.remove faz.
    remove: jest.fn(async (userId: string, id: string) => {
      const index = transactions.findIndex((row) => row.id === id && row.userId === userId);
      if (index === -1) throw new NotFoundException('Lançamento não encontrado');
      transactions.splice(index, 1);
      return { success: true };
    }),
  };
  const deps = [db.prisma, {}, {}, txService, {}, {}, {}, {}, {}, { get: jest.fn(() => writesEnabled) }];
  const service = new ConversationService(...(deps as unknown as Deps));
  let counter = 0;
  const send = (text: string, userId = 'A', channel: 'APP' | 'WHATSAPP' = 'APP') => {
    counter += 1;
    const input: ConversationInput = { userId, channel, messageId: `m${counter}`, text, receivedAt: T0 };
    return service.handleMessage(input);
  };
  return { db, service, txService, transactions, send };
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

describe('apagar reforcado (8a, secao 4)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('apagar confirma e apaga de vez pelo mesmo servico da tela, com recibo', async () => {
    const { send, txService, transactions } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    const reply = await send('apagar');
    expect(reply.kind).toBe('DONE');
    expect(reply.state).toBe('IDLE');
    expect(reply.text).toBe('Apaguei: 120,00 · Mercado grande.');
    expect(reply.data?.transactionId).toBe('t2');
    expect(txService.remove).toHaveBeenCalledTimes(1);
    expect(txService.remove).toHaveBeenCalledWith('A', 't2');
    expect(transactions.some((row) => row.id === 't2')).toBe(false);
  });

  it.each(['confirmar', 'sim', 'ok'])('"%s" nao apaga o lancamento: pede a palavra apagar', async (word) => {
    const { send, txService, db } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    const reply = await send(word);
    expect(reply.text).toContain('Para apagar, responda apagar.');
    expect(reply.state).toBe('AWAITING_CONFIRMATION');
    expect(txService.remove).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(1);
  });

  it('o botao Confirmar (endpoint) recusa rascunho de apagar e nao apaga', async () => {
    const { send, txService, db, service } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    const session = db.sessions[0];
    const reply = await service.confirmDraft('A', session.id, session.version);
    expect(reply?.kind).toBe('ERROR');
    expect(reply?.text).toBe('Para apagar, responda apagar.');
    expect(txService.remove).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(1);
  });

  it('apagar duas vezes (ou em paralelo) apaga uma so vez', async () => {
    const { send, txService } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    await Promise.all([send('apagar'), send('apagar')]);
    expect(txService.remove).toHaveBeenCalledTimes(1);
  });

  it('lancamento sumiu antes de apagar: erro, nada apagado e sessao descartada', async () => {
    const { send, txService, db } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    txService.remove.mockRejectedValueOnce(new NotFoundException('Lançamento não encontrado'));
    const reply = await send('apagar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Lançamento não encontrado');
    expect(db.sessions).toHaveLength(0);
  });

  it('WhatsApp com escrita desligada: apagar nao grava', async () => {
    const { send, txService } = buildService(ROWS, false);
    await send('apagar mercado', 'A', 'WHATSAPP');
    await send('2', 'A', 'WHATSAPP');
    const reply = await send('apagar', 'A', 'WHATSAPP');
    expect(reply.kind).toBe('INFO');
    expect(txService.remove).not.toHaveBeenCalled();
  });
});

type ConversationReplyLike = Awaited<ReturnType<ConversationService['handleMessage']>>;

describe('editar lancamento (8a, secao 5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** "corrigir mercado" + escolha do número: pergunta o que mudar. */
  async function pick(send: (text: string) => Promise<ConversationReplyLike>, number: string) {
    await send('corrigir mercado');
    return send(number);
  }

  it('escolher o lancamento pergunta o que mudar', async () => {
    const { send } = buildService(ROWS);
    const reply = await pick(send, '1');
    expect(reply.kind).toBe('ASK_FIELD');
    expect(reply.text).toBe('O que mudar? valor, descrição, categoria ou data. Ex.: valor 45');
  });

  it('valor mostra antes -> depois e aguarda confirmar', async () => {
    const { send } = buildService(ROWS);
    await pick(send, '1');
    const reply = await send('valor 45');
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    expect(reply.state).toBe('AWAITING_CONFIRMATION');
    expect(reply.text).toContain('Editar: 50,00 · Mercado do bairro.');
    expect(reply.text).toContain('Valor: 50,00 -> 45,00');
    expect(reply.text).toContain('Responda confirmar para salvar ou cancelar.');
    expect(reply.quickReplies).toEqual(['confirmar', 'cancelar']);
  });

  it('varias mudancas em mensagens seguidas aparecem todas na previa', async () => {
    const { send } = buildService(ROWS);
    await pick(send, '1');
    await send('descrição Padaria da esquina');
    const reply = await send('data 13/11');
    expect(reply.text).toContain('Descrição: Mercado do bairro -> Padaria da esquina');
    expect(reply.text).toContain('Data: 14/11 -> 13/11');
  });

  it('categoria pelo nome: mostra sem categoria -> Padaria', async () => {
    const { send } = buildService(ROWS);
    await pick(send, '2');
    const reply = await send('categoria padaria');
    expect(reply.text).toContain('Categoria: sem categoria -> Padaria');
  });

  it('categoria ambigua ou inexistente: erro e rascunho segue', async () => {
    const { send, db } = buildService(ROWS);
    await pick(send, '2');
    const ambiguous = await send('categoria pad');
    expect(ambiguous.kind).toBe('ERROR');
    expect(ambiguous.text).toBe('Tem mais de uma categoria com esse nome. Escreva o nome completo.');
    const missing = await send('categoria xyz');
    expect(missing.text).toBe('Não achei essa categoria. Use o nome de uma categoria sua.');
    expect(db.sessions).toHaveLength(1);
  });

  it.each([
    ['valor 0', 'ERROR'],
    ['data 31/02', 'ERROR'],
    ['tipo receita', 'ERROR'],
    ['descrição a', 'ERROR'],
  ])('"%s" e recusado sem gravar', async (text, kind) => {
    const { send, txService } = buildService(ROWS);
    await pick(send, '1');
    const reply = await send(text);
    expect(reply.kind).toBe(kind);
    expect(txService.update).not.toHaveBeenCalled();
  });

  it('confirmar sem nenhuma mudanca nao grava', async () => {
    const { send, txService } = buildService(ROWS);
    await pick(send, '1');
    const reply = await send('confirmar');
    expect(reply.text).toContain('Nada para mudar. Escolha um campo ou responda cancelar.');
    expect(txService.update).not.toHaveBeenCalled();
  });

  it('confirmar aplica so o campo mudado, pelo TransactionsService.update, com recibo', async () => {
    const { send, txService, db } = buildService(ROWS);
    await pick(send, '1');
    await send('valor 45');
    const reply = await send('confirmar');
    expect(reply.kind).toBe('DONE');
    expect(reply.state).toBe('IDLE');
    expect(reply.text).toBe('Alterei: 45,00 · Mercado do bairro.');
    expect(reply.data?.transactionId).toBe('t1');
    expect(txService.update).toHaveBeenCalledTimes(1);
    expect(txService.update).toHaveBeenCalledWith('A', 't1', { amount: 45 }, ROWS[0].updatedAt);
    expect(db.sessions).toHaveLength(0);
  });

  it('varios campos: o DTO leva cada um no formato da tela', async () => {
    const { send, txService } = buildService(ROWS);
    await pick(send, '2');
    await send('valor 99,90');
    await send('descrição Padaria nova');
    await send('categoria mercado');
    await send('data 13/11');
    await send('confirmar');
    expect(txService.update).toHaveBeenCalledWith(
      'A',
      't2',
      {
        amount: 99.9,
        description: 'Padaria nova',
        categoryId: 'cat-mercado',
        type: 'EXPENSE',
        date: '2026-11-13T00:00:00.000Z',
      },
      ROWS[1].updatedAt,
    );
  });

  it('conflito de updatedAt: nada gravado, rascunho descartado', async () => {
    const { send, txService, transactions, db } = buildService(ROWS);
    await pick(send, '1');
    await send('valor 45');
    transactions[0].updatedAt = new Date('2026-11-15T09:00:00.000Z');
    const reply = await send('confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Esse lançamento mudou desde que você escolheu; refaça a busca.');
    expect(txService.update).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(0);
  });

  it('cancelar descarta sem gravar', async () => {
    const { send, txService, db } = buildService(ROWS);
    await pick(send, '1');
    await send('valor 45');
    const reply = await send('cancelar');
    expect(reply.kind).toBe('CANCELLED');
    expect(txService.update).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(0);
  });
});

describe('revisao 8a-1: travas de apagar e editar', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['apagar tudo', 'apagar 1', 'sim apagar', 'confirmar apagar', 'nao apagar', 'apagar mercado', 'excluir', 'ok', 'sim', 'confirmar'])(
    'variante "%s" na confirmacao nao apaga',
    async (text) => {
      const { send, txService, db } = buildService(ROWS);
      await send('apagar mercado');
      await send('2');
      await send(text);
      expect(txService.remove).not.toHaveBeenCalled();
      expect(db.sessions).toHaveLength(1);
    },
  );

  it.each(['Apagar!', '  APAGAR  ', 'apagar'])('a palavra "%s" sozinha apaga uma vez', async (text) => {
    const { send, txService } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    const reply = await send(text);
    expect(reply.kind).toBe('DONE');
    expect(txService.remove).toHaveBeenCalledTimes(1);
  });

  it('a palavra apagar antes de escolher o lancamento nao apaga nada', async () => {
    const { send, txService } = buildService(ROWS);
    await send('apagar mercado');
    await send('apagar');
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('candidato forjado de outra conta na lista: escolher da erro e nao vira alvo', async () => {
    const { send, db, txService } = buildService(ROWS);
    await send('apagar mercado');
    (db.sessions[0].draft as Row).candidateIds = ['t4'];
    const reply = await send('1');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Não encontrei mais esse lançamento.');
    expect((db.sessions[0].draft as Row).targetId).toBeNull();
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('alvo forjado de outra conta na aplicacao: nada e apagado', async () => {
    const { send, db, txService } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    (db.sessions[0].draft as Row).targetId = 't4';
    const reply = await send('apagar');
    expect(reply.kind).toBe('ERROR');
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('candidato forjado de outra conta: a lista numerada nao mostra a linha dele', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar mercado');
    (db.sessions[0].draft as Row).candidateIds = ['t4', 't1'];
    const reply = await send('9');
    expect(reply.text).not.toContain('Mercado de B');
    expect(reply.text).not.toContain('10,00');
  });

  it('candidato nao elegivel forjado na lista nao e escolhido', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar mercado');
    (db.sessions[0].draft as Row).candidateIds = ['t3'];
    const reply = await send('1');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toContain('altere pela tela');
    expect((db.sessions[0].draft as Row).targetId).toBeNull();
  });

  it('a lista nao mostra item que deixou de ser elegivel', async () => {
    const { send, transactions } = buildService(ROWS);
    await send('apagar mercado');
    transactions[0].linkedGoalId = 'goal-1';
    const reply = await send('9');
    expect(reply.text).not.toContain('Mercado do bairro');
    expect(reply.text).toContain('Mercado grande');
  });

  it.each(['apagar', 'editar'])('alvo que virou nao elegivel antes de aplicar (%s): nada e gravado', async (verb) => {
    const { send, transactions, txService, db } = buildService(ROWS);
    await send(verb === 'apagar' ? 'apagar mercado' : 'corrigir mercado');
    await send('1');
    if (verb === 'editar') await send('valor 45');
    transactions[0].installmentPurchaseId = 'inst-1';
    const reply = await send(verb === 'apagar' ? 'apagar' : 'confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(txService.remove).not.toHaveBeenCalled();
    expect(txService.update).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(0);
  });

  it('rascunho antigo com alvo recorrente: apagar recusa', async () => {
    const { send, db, txService } = buildService(ROWS);
    await send('apagar mercado');
    await send('2');
    (db.sessions[0].draft as Row).targetId = 't3';
    await send('apagar');
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('corrida com a tela: o servico recusa por updatedAt e a resposta e de conflito', async () => {
    const { send, txService, db } = buildService(ROWS);
    await send('corrigir mercado');
    await send('1');
    await send('valor 45');
    txService.update.mockRejectedValueOnce(new ConflictException('x'));
    const reply = await send('confirmar');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Esse lançamento mudou desde que você escolheu; refaça a busca.');
    expect(db.sessions).toHaveLength(0);
  });

  it('categoria de outro tipo (receita) nao serve para despesa', async () => {
    const { send } = buildService(ROWS);
    await send('corrigir mercado');
    await send('2');
    const reply = await send('categoria padaria de receita');
    expect(reply.kind).toBe('ERROR');
    expect(reply.text).toBe('Não achei essa categoria. Use o nome de uma categoria sua.');
  });

  it('confirmar duas vezes a edicao aplica uma so vez', async () => {
    const { send, txService } = buildService(ROWS);
    await send('corrigir mercado');
    await send('1');
    await send('valor 45');
    await Promise.all([send('confirmar'), send('confirmar')]);
    expect(txService.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['recurringTransactionId', 'rec-1'],
    ['installmentPurchaseId', 'inst-1'],
    ['linkedGoalId', 'goal-1'],
    ['receiptScan', { id: 'scan-1' }],
  ])('nao elegivel por %s: fora da lista', async (field, value) => {
    const rows = [txRow({ id: 'x1', userId: 'A', description: 'Padaria x', amount: '5.00', date: day('2026-11-14'), [field]: value })];
    const { send, db } = buildService(rows);
    const reply = await send('apagar padaria');
    expect(reply.kind).toBe('INFO');
    expect(reply.text).toContain('altere pela tela');
    expect(db.sessions).toHaveLength(0);
  });

  it('ordem da lista: data desc e, no empate, createdAt desc', async () => {
    const rows = [
      txRow({ id: 'o1', userId: 'A', description: 'Lanche a', date: day('2026-11-10'), createdAt: new Date('2026-11-10T08:00:00.000Z') }),
      txRow({ id: 'o2', userId: 'A', description: 'Lanche b', date: day('2026-11-12'), createdAt: new Date('2026-11-12T08:00:00.000Z') }),
      txRow({ id: 'o3', userId: 'A', description: 'Lanche c', date: day('2026-11-12'), createdAt: new Date('2026-11-12T09:00:00.000Z') }),
    ];
    const { send, db } = buildService(rows);
    await send('apagar lanche');
    expect((db.sessions[0].draft as Row).candidateIds).toEqual(['o3', 'o2', 'o1']);
  });

  it('novo comando de escrita durante a lista nao vira busca: lembra o rascunho e mantem a sessao', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar');
    const before = db.sessions[0].version;
    const reply = await send('corrigir mercado');
    expect(reply.text).toContain('Responda a pergunta ou "cancelar"');
    expect(db.sessions[0].version).toBe(before);
    expect((db.sessions[0].draft as Row).candidateIds).toEqual([]);
  });

  it('ajuda durante a lista nao vira busca nem muda a sessao', async () => {
    const { send, db } = buildService(ROWS);
    await send('apagar');
    const before = db.sessions[0].version;
    const reply = await send('ajuda');
    expect(reply.kind).toBe('HELP');
    expect(db.sessions[0].version).toBe(before);
    expect((db.sessions[0].draft as Row).candidateIds).toEqual([]);
  });
});

describe('apagar pelo botao do cartao (8a-2, contrato 4.4)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Escolhe "apagar mercado" -> 2 (120,00 · Mercado grande) e devolve o rascunho de apagar. */
  async function draftToDelete(send: (text: string, userId?: string, channel?: 'APP' | 'WHATSAPP') => Promise<ConversationReplyLike>) {
    await send('apagar mercado');
    return send('2');
  }

  it('DraftView leva changeAction DELETE no cartao de apagar e EDIT no de editar', async () => {
    const { send } = buildService(ROWS);
    const deleteReply = await draftToDelete(send);
    expect(deleteReply.draft?.changeAction).toBe('DELETE');
    const { send: sendEdit } = buildService(ROWS);
    await sendEdit('corrigir mercado');
    const editReply = await sendEdit('1');
    expect(editReply.draft?.changeAction).toBe('EDIT');
  });

  it('previa do apagar mostra valor, descricao, categoria e data do lancamento escolhido', async () => {
    const { send } = buildService(ROWS);
    const reply = await draftToDelete(send);
    expect(reply.draft?.rows).toEqual([
      { label: 'Valor', value: expect.stringContaining('120,00') },
      { label: 'Descrição', value: 'Mercado grande' },
      { label: 'Categoria', value: 'sem categoria' },
      { label: 'Data', value: '12/11/2026' },
    ]);
  });

  it('rascunho de lancamento comum nao traz changeAction', async () => {
    const { send } = buildService(ROWS);
    const reply = await send('gastei 32,90 mercado');
    expect(reply.draft).toBeDefined();
    expect(reply.draft).not.toHaveProperty('changeAction');
  });

  it('GET de sessao (restaurada) traz changeAction DELETE e nao grava nada', async () => {
    const { send, service, txService } = buildService(ROWS);
    await draftToDelete(send);
    const restored = await service.getSession('A');
    expect(restored.state).toBe('AWAITING_CONFIRMATION');
    expect(restored.draft?.changeAction).toBe('DELETE');
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('confirmDraft de apagar SEM flag: texto da palavra, nada gravado, sessao mantida', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    const reply = await service.confirmDraft('A', session.id, session.version, false);
    expect(reply?.kind).toBe('ERROR');
    expect(reply?.text).toBe('Para apagar, responda apagar.');
    expect(txService.remove).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(1);
  });

  it('confirmDraft de apagar COM flag: apaga 1x pelo mesmo servico, com recibo', async () => {
    const { send, service, txService, transactions, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    const reply = await service.confirmDraft('A', session.id, session.version, true);
    expect(reply?.kind).toBe('DONE');
    expect(reply?.state).toBe('IDLE');
    expect(reply?.text).toBe('Apaguei: 120,00 · Mercado grande.');
    expect(reply?.data?.transactionId).toBe('t2');
    expect(txService.remove).toHaveBeenCalledTimes(1);
    expect(txService.remove).toHaveBeenCalledWith('A', 't2');
    expect(transactions.some((row) => row.id === 't2')).toBe(false);
    expect(db.sessions).toHaveLength(0);
  });

  it('reconfirmar o mesmo rascunho com flag nao apaga de novo (sessao ja consumida)', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    await service.confirmDraft('A', session.id, session.version, true);
    await expect(service.confirmDraft('A', session.id, session.version, true)).resolves.toBeNull();
    expect(txService.remove).toHaveBeenCalledTimes(1);
  });

  it('dois cliques paralelos com flag: uma so aplicacao', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    const results = await Promise.all([
      service.confirmDraft('A', session.id, session.version, true),
      service.confirmDraft('A', session.id, session.version, true),
    ]);
    expect(results.filter((result) => result?.kind === 'DONE')).toHaveLength(1);
    expect(txService.remove).toHaveBeenCalledTimes(1);
  });

  it('versao antiga com flag: 404 (null), nada apagado', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    await expect(service.confirmDraft('A', session.id, session.version + 1, true)).resolves.toBeNull();
    expect(txService.remove).not.toHaveBeenCalled();
    expect(db.sessions).toHaveLength(1);
  });

  it('flag com rascunho de apagar de outra conta: null, nada apagado', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    await expect(service.confirmDraft('B', session.id, session.version, true)).resolves.toBeNull();
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('flag com lancamento que sumiu: erro, nada apagado e sessao descartada', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await draftToDelete(send);
    const session = db.sessions[0];
    txService.remove.mockRejectedValueOnce(new NotFoundException('Lançamento não encontrado'));
    const reply = await service.confirmDraft('A', session.id, session.version, true);
    expect(reply?.kind).toBe('ERROR');
    expect(reply?.text).toBe('Lançamento não encontrado');
    expect(db.sessions).toHaveLength(0);
  });

  it('botao do app com flag nao passa pela trava do WhatsApp, como o confirmar comum', async () => {
    const { send, service, txService, db } = buildService(ROWS, false);
    await send('apagar mercado', 'A', 'WHATSAPP');
    await send('2', 'A', 'WHATSAPP');
    const session = db.sessions[0];
    const reply = await service.confirmDraft('A', session.id, session.version, true);
    expect(reply?.kind).toBe('DONE');
    expect(txService.remove).toHaveBeenCalledTimes(1);
  });

  it('flag em rascunho de editar e ignorada: confirma a edicao normal, uma vez', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    await send('corrigir mercado');
    await send('1');
    await send('valor 45');
    const session = db.sessions[0];
    const reply = await service.confirmDraft('A', session.id, session.version, true);
    expect(reply?.kind).toBe('DONE');
    expect(reply?.text).toBe('Alterei: 45,00 · Mercado do bairro.');
    expect(txService.update).toHaveBeenCalledTimes(1);
    expect(txService.remove).not.toHaveBeenCalled();
  });

  it('flag em rascunho comum e ignorada (confirmar normal)', async () => {
    const { send, service, txService, db } = buildService(ROWS);
    txService.create.mockResolvedValueOnce({ id: 'new-1' });
    await send('gastei 32,90 mercado');
    const session = db.sessions[0];
    expect(session.state).toBe('AWAITING_CONFIRMATION');
    const reply = await service.confirmDraft('A', session.id, session.version, true);
    expect(reply?.kind).toBe('DONE');
    expect(txService.create).toHaveBeenCalledTimes(1);
    expect(txService.remove).not.toHaveBeenCalled();
  });
});
