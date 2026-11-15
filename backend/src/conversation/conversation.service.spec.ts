import { ConversationChannel, ConversationOutcome, ConversationState, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConversationInput } from './conversation.types';
import { ConversationService } from './conversation.service';

type Deps = ConstructorParameters<typeof ConversationService>;

// Linhas do banco fake: tipos livres de proposito (o teste le campos do rascunho).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Filtro de igualdade (com `in` para listas), suficiente para o motor. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && 'in' in expected) {
      return (expected.in as unknown[]).includes(row[key]);
    }
    return row[key] === expected;
  });
}

const clone = <T>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

function uniqueViolation(target: string[] = []): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
}

/** Postgres em memoria: so o necessario para o motor, com as unicidades do schema. */
function buildFakeDb() {
  const sessions: Row[] = [];
  const events: Row[] = [];
  const categories: Row[] = [
    { id: 'cat-mercado', userId: 'A', name: 'Mercado', type: 'EXPENSE' },
    { id: 'cat-alimentacao', userId: 'A', name: 'Alimentação', type: 'EXPENSE' },
    { id: 'cat-salario', userId: 'A', name: 'Salário', type: 'INCOME' },
    { id: 'cat-mercado-b', userId: 'B', name: 'Mercado', type: 'EXPENSE' },
  ];
  const timezones: Record<string, string> = { A: 'America/Sao_Paulo', B: 'America/Sao_Paulo' };

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({
        timezone: timezones[where.id] ?? 'America/Sao_Paulo',
      })),
    },
    conversationSession: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(sessions.find((row) => matches(row, where)) ?? null)),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = sessions.length;
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (matches(sessions[index], where)) sessions.splice(index, 1);
        }
        return { count: before - sessions.length };
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (sessions.some((row) => row.userId === data.userId && row.channel === data.channel)) throw uniqueViolation();
        if (data.id && sessions.some((row) => row.id === data.id)) throw uniqueViolation();
        const row = { id: data.id ?? randomUUID(), version: 1, ...data };
        sessions.push(row);
        return clone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = sessions.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    conversationEvent: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(events.find((row) => matches(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (data.appliedKey && events.some((row) => row.appliedKey === data.appliedKey)) throw uniqueViolation(['appliedKey']);
        if (
          data.messageId !== null &&
          data.messageId !== undefined &&
          events.some((row) => row.userId === data.userId && row.channel === data.channel && row.messageId === data.messageId)
        ) {
          throw uniqueViolation(['userId', 'channel', 'messageId']);
        }
        const row = { id: randomUUID(), messageId: null, appliedKey: null, resultRef: null, ...data };
        events.push(row);
        return clone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = events.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    financeCategory: {
      findMany: jest.fn(async ({ where }: { where: Row }) => clone(categories.filter((row) => matches(row, where)))),
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(categories.find((row) => matches(row, where)) ?? null)),
    },
    transaction: {
      groupBy: jest.fn(async () => [
        { categoryId: 'cat-mercado', _sum: { amount: new Prisma.Decimal(300) } },
        { categoryId: 'cat-alimentacao', _sum: { amount: new Prisma.Decimal(120.5) } },
      ]),
    },
  };

  return { prisma, sessions, events, categories };
}

const T0 = new Date('2026-11-15T12:00:00.000Z');

describe('ConversationService', () => {
  let db: ReturnType<typeof buildFakeDb>;
  let transactions: { create: jest.Mock };
  let dashboard: { getSummary: jest.Mock };
  let creditCycle: { getCurrent: jest.Mock };
  let service: ConversationService;

  beforeEach(() => {
    db = buildFakeDb();
    transactions = { create: jest.fn(async () => ({ id: 'tx-1' })) };
    dashboard = {
      getSummary: jest.fn(async () => ({
        finances: { balance: 1234.5, monthlyIncome: 3000, monthlyExpenses: 1500 },
      })),
    };
    creditCycle = {
      getCurrent: jest.fn(async () => ({
        ceiling: 2000,
        spent: 500,
        remaining: 1500,
        percentUsed: 25,
        status: 'ok',
        closingDay: 5,
        dueDay: 12,
      })),
    };
    service = new ConversationService(
      db.prisma as unknown as Deps[0],
      dashboard as unknown as Deps[1],
      creditCycle as unknown as Deps[2],
      transactions as unknown as Deps[3],
    );
  });

  const msg = (userId: string, text: string, receivedAt: Date = T0, messageId = randomUUID()): ConversationInput => ({
    userId,
    channel: ConversationChannel.APP,
    messageId,
    text,
    receivedAt,
  });

  /** Cria um rascunho completo (AWAITING_CONFIRMATION) para o usuario. */
  async function draftFor(userId: string, text = '50 mercado') {
    const reply = await service.handleMessage(msg(userId, text));
    expect(reply.kind).toBe('CONFIRM_DRAFT');
    return reply;
  }

  describe('criacao de rascunho', () => {
    it('"50 mercado" cria rascunho com categoria, nao grava na primeira mensagem', async () => {
      const reply = await draftFor('A', '50 mercado');

      expect(reply.state).toBe(ConversationState.AWAITING_CONFIRMATION);
      expect(reply.draft).toMatchObject({
        amount: expect.stringMatching(/^R\$\s50,00$/),
        description: 'mercado',
        category: 'Mercado',
        pendingField: null,
      });
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('valor em centavos inteiros no rascunho guardado', async () => {
      await draftFor('A', 'gastei 32,90 mercado');
      expect(db.sessions[0].draft.amountCents).toBe(3290);
    });

    it('data no texto entra no rascunho e data futura aparece no aviso', async () => {
      const reply = await draftFor('A', '50 mercado 10/12');
      expect(reply.draft?.date).toBe('2026-12-10');
      expect(reply.text).toContain('A data é futura');
    });

    it('data invalida devolve erro e nao cria sessao', async () => {
      const reply = await service.handleMessage(msg('A', '50 mercado 31/02'));
      expect(reply.kind).toBe('ERROR');
      expect(db.sessions).toHaveLength(0);
    });

    it('zero, negativo e acima do limite pedem correcao, sem sessao', async () => {
      for (const text of ['gastei 0', '-5 mercado', '2000000 mercado']) {
        const reply = await service.handleMessage(msg('A', text));
        expect(reply.kind).toBe('ERROR');
      }
      expect(db.sessions).toHaveLength(0);
    });

    it('valor ambiguo (1,234) pede correcao e nao chuta', async () => {
      const reply = await service.handleMessage(msg('A', '1,234 mercado'));
      expect(reply.kind).toBe('ERROR');
      expect(reply.text).toContain('ambíguo');
      expect(db.sessions).toHaveLength(0);
    });

    it('sem descricao pergunta o campo (COLLECTING_FIELDS)', async () => {
      const reply = await service.handleMessage(msg('A', '50'));
      expect(reply.kind).toBe('ASK_FIELD');
      expect(reply.state).toBe(ConversationState.COLLECTING_FIELDS);
      expect(reply.draft?.pendingField).toBe('description');
    });

    it('receita: "recebi 800 de freelance" vira rascunho INCOME', async () => {
      const reply = await service.handleMessage(msg('A', 'recebi 800 de freelance'));
      expect(reply.kind).toBe('ASK_FIELD');
      expect(reply.draft?.type).toBe('INCOME');
      expect(reply.draft?.description).toBe('freelance');
    });

    it('categoria desconhecida pergunta uma vez; "sem categoria" fecha o rascunho', async () => {
      const ask = await service.handleMessage(msg('A', 'gastei 32,90 na farmácia'));
      expect(ask.kind).toBe('ASK_FIELD');
      expect(ask.draft?.pendingField).toBe('category');
      expect(ask.draft?.description).toBe('farmácia');

      const done = await service.handleMessage(msg('A', 'sem categoria'));
      expect(done.kind).toBe('CONFIRM_DRAFT');
      expect(done.draft?.category).toBeNull();
    });

    it('varias categorias candidatas perguntam com opcoes numeradas', async () => {
      db.categories.push({ id: 'cat-mercadinho', userId: 'A', name: 'Mercadinho', type: 'EXPENSE' });
      const reply = await service.handleMessage(msg('A', '50 merc'));
      expect(reply.kind).toBe('ASK_FIELD');
      expect(reply.text).toContain('1) Mercado');
      expect(reply.text).toContain('2) Mercadinho');
    });
  });

  describe('campo que falta', () => {
    it('responde a descricao e fecha o rascunho', async () => {
      await service.handleMessage(msg('A', '50'));
      const reply = await service.handleMessage(msg('A', 'mercado'));
      expect(reply.kind).toBe('CONFIRM_DRAFT');
      expect(reply.draft?.category).toBe('Mercado');
    });

    it('"confirmar" durante a coleta nao faz nada', async () => {
      await service.handleMessage(msg('A', '50'));
      const reply = await service.handleMessage(msg('A', 'confirmar'));
      expect(reply.kind).toBe('ASK_FIELD');
      expect(reply.state).toBe(ConversationState.COLLECTING_FIELDS);
      expect(transactions.create).not.toHaveBeenCalled();
    });
  });

  describe('confirmar', () => {
    it('botao confirma uma vez e grava com userId da conta', async () => {
      await draftFor('A', 'gastei 32,90 mercado');
      const draft = db.sessions[0];

      const reply = await service.confirmDraft('A', draft.id, draft.version);

      expect(reply?.kind).toBe('DONE');
      expect(reply?.data?.transactionId).toBe('tx-1');
      expect(transactions.create).toHaveBeenCalledTimes(1);
      expect(transactions.create).toHaveBeenCalledWith(
        'A',
        expect.objectContaining({ type: 'EXPENSE', amount: 32.9, categoryId: 'cat-mercado' }),
      );
    });

    it('grava a data a meia-noite UTC, como a tela de Finanças', async () => {
      await draftFor('A', 'gastei 32,90 mercado');
      const draft = db.sessions[0];

      await service.confirmDraft('A', draft.id, draft.version);

      const dto = transactions.create.mock.calls[0][1];
      expect(dto.date).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    });

    it('texto "confirmar" grava e a mesma mensagem repetida devolve DUPLICATE', async () => {
      await draftFor('A', '50 mercado');
      const confirmMessage = msg('A', 'confirmar');

      const first = await service.handleMessage(confirmMessage);
      const second = await service.handleMessage(confirmMessage);

      expect(first.kind).toBe('DONE');
      expect(second.kind).toBe('DUPLICATE');
      expect(transactions.create).toHaveBeenCalledTimes(1);
    });

    it('mensagem repetida em rascunho novo devolve DUPLICATE sem reprocessar', async () => {
      const repeated = msg('A', '50 mercado');
      await service.handleMessage(repeated);
      const second = await service.handleMessage(repeated);
      expect(second.kind).toBe('DUPLICATE');
      expect(db.sessions).toHaveLength(1);
    });

    it('confirmar duas vezes em sequencia: a segunda responde 404 (null)', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];
      await service.confirmDraft('A', draft.id, draft.version);

      await expect(service.confirmDraft('A', draft.id, draft.version)).resolves.toBeNull();
      expect(transactions.create).toHaveBeenCalledTimes(1);
    });

    it('duas confirmacoes concorrentes geram uma unica chamada ao servico financeiro', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];

      const results = await Promise.all([
        service.confirmDraft('A', draft.id, draft.version),
        service.confirmDraft('A', draft.id, draft.version),
      ]);

      const kinds = results.map((result) => result?.kind ?? 'NOT_FOUND').sort();
      expect(kinds).toEqual(['DONE', 'DUPLICATE'].sort());
      expect(transactions.create).toHaveBeenCalledTimes(1);
    });

    it('versao antiga do rascunho (editado depois) e rejeitada', async () => {
      await service.handleMessage(msg('A', '50'));
      const oldVersion = db.sessions[0].version;
      await service.handleMessage(msg('A', 'mercado'));

      await expect(service.confirmDraft('A', db.sessions[0].id, oldVersion)).resolves.toBeNull();
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('"confirmar" sem rascunho nao faz acao', async () => {
      const reply = await service.handleMessage(msg('A', 'confirmar'));
      expect(reply.kind).toBe('HELP');
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('falha em TransactionsService.create devolve o rascunho e nao grava nada', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];
      transactions.create.mockRejectedValueOnce(new Error('falha simulada'));

      const failed = await service.confirmDraft('A', draft.id, draft.version);

      expect(failed?.kind).toBe('ERROR');
      expect(failed?.state).toBe(ConversationState.AWAITING_CONFIRMATION);
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].id).toBe(draft.id);
      expect(db.events.find((event) => event.appliedKey)).toBeUndefined();

      // Nova tentativa funciona com o mesmo rascunho.
      const retry = await service.confirmDraft('A', draft.id, draft.version);
      expect(retry?.kind).toBe('DONE');
      expect(transactions.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('cancelar', () => {
    it('"cancelar" descarta o rascunho sem gravar', async () => {
      await draftFor('A', '50 mercado');
      const reply = await service.handleMessage(msg('A', 'cancelar'));
      expect(reply.kind).toBe('CANCELLED');
      expect(db.sessions).toHaveLength(0);
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('botao cancelar de outra conta responde null e nada muda', async () => {
      const draft = await draftFor('A', '50 mercado');
      const draftId = draft.draft!.draftId;

      await expect(service.cancelDraft('B', draftId)).resolves.toBeNull();
      expect(db.sessions).toHaveLength(1);
    });
  });

  describe('isolamento entre contas A e B', () => {
    it('B nao le, nao confirma e nao cancela o rascunho de A', async () => {
      const draft = await draftFor('A', '50 mercado');
      const draftId = draft.draft!.draftId;
      const version = draft.draft!.draftVersion;

      await expect(service.confirmDraft('B', draftId, version)).resolves.toBeNull();
      await expect(service.cancelDraft('B', draftId)).resolves.toBeNull();
      await expect(service.getSession('B')).resolves.toEqual({ state: 'IDLE' });

      expect(transactions.create).not.toHaveBeenCalled();
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].userId).toBe('A');
    });

    it('B nao e afetado por mensagens de A, e a sessao de A continua em A', async () => {
      await draftFor('A', '50 mercado');
      const reply = await service.handleMessage(msg('B', 'confirmar'));

      expect(reply.kind).toBe('HELP');
      expect(db.sessions).toHaveLength(1);
      expect(db.sessions[0].userId).toBe('A');
    });

    it('B nao consegue gravar em A mesmo quando envia a mesma mensagem', async () => {
      const shared = msg('A', '50 mercado');
      await service.handleMessage(shared);
      const forB = { ...shared, userId: 'B' };

      const reply = await service.handleMessage(forB);
      expect(reply.kind).toBe('CONFIRM_DRAFT');
      expect(db.sessions.map((row) => row.userId).sort()).toEqual(['A', 'B']);
    });
  });

  describe('expiracao (relogio controlado)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: T0 });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('coleta expira em 15 minutos', async () => {
      await service.handleMessage(msg('A', '50', T0));

      const reply = await service.handleMessage(msg('A', 'mercado', new Date(T0.getTime() + 15 * 60_000 + 1000)));

      expect(reply.kind).toBe('EXPIRED');
      expect(db.sessions).toHaveLength(0);
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('coleta ainda vale aos 14 minutos e renova o prazo', async () => {
      await service.handleMessage(msg('A', '50', T0));
      const reply = await service.handleMessage(msg('A', 'mercado', new Date(T0.getTime() + 14 * 60_000)));
      expect(reply.kind).toBe('CONFIRM_DRAFT');
    });

    it('confirmacao expira em 5 minutos (botao, relogio do servidor)', async () => {
      const draft = await draftFor('A', '50 mercado');
      jest.setSystemTime(new Date(T0.getTime() + 5 * 60_000 + 1000));

      const reply = await service.confirmDraft('A', draft.draft!.draftId, draft.draft!.draftVersion);

      expect(reply?.kind).toBe('EXPIRED');
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('confirmacao por texto expira em 5 minutos', async () => {
      await draftFor('A', '50 mercado');
      const reply = await service.handleMessage(msg('A', 'sim', new Date(T0.getTime() + 5 * 60_000 + 1000)));
      expect(reply.kind).toBe('EXPIRED');
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('getSession trata sessao expirada como IDLE', async () => {
      await draftFor('A', '50 mercado');
      jest.setSystemTime(new Date(T0.getTime() + 6 * 60_000));
      await expect(service.getSession('A')).resolves.toEqual({ state: 'IDLE' });
    });
  });

  describe('leituras', () => {
    it('saldo usa DashboardService.getSummary e responde em reais', async () => {
      const reply = await service.handleMessage(msg('A', 'saldo'));
      expect(reply.kind).toBe('INFO');
      expect(reply.data?.balanceCents).toBe(123450);
      expect(reply.text).toContain('R$');
      expect(dashboard.getSummary).toHaveBeenCalledWith('A');
    });

    it('resumo do mes traz entradas, saidas e saldo', async () => {
      const reply = await service.handleMessage(msg('A', 'resumo'));
      expect(reply.data).toEqual({ incomeCents: 300000, expenseCents: 150000, balanceCents: 123450 });
    });

    it('gastos com categoria soma as transacoes da categoria da conta', async () => {
      const reply = await service.handleMessage(msg('A', 'gastos com mercado'));
      expect(reply.kind).toBe('INFO');
      expect(reply.data?.categories?.[0]).toEqual({ name: 'Mercado', amountCents: 30000 });
    });

    it('credit_card sem teto responde que nao ha limite definido', async () => {
      creditCycle.getCurrent.mockResolvedValueOnce({
        ceiling: null,
        spent: 0,
        remaining: null,
        percentUsed: null,
        status: 'none',
        closingDay: 5,
        dueDay: null,
      });
      const reply = await service.handleMessage(msg('A', 'limite do cartão'));
      expect(reply.text).toBe('Não há limite definido neste ciclo do cartão.');
    });

    it('credit_card com teto traz usado e disponivel', async () => {
      const reply = await service.handleMessage(msg('A', 'cartao'));
      expect(reply.data?.card).toMatchObject({ ceilingCents: 200000, spentCents: 50000, remainingCents: 150000 });
    });

    it('leitura nao muda o rascunho em andamento', async () => {
      await draftFor('A', '50 mercado');
      const before = db.sessions[0].version;
      const reply = await service.handleMessage(msg('A', 'saldo'));
      expect(reply.kind).toBe('INFO');
      expect(reply.state).toBe(ConversationState.AWAITING_CONFIRMATION);
      expect(db.sessions[0].version).toBe(before);
    });
  });

  describe('eventos e privacidade', () => {
    it('eventos nao guardam o texto da mensagem', async () => {
      await draftFor('A', '50 mercado');
      await service.handleMessage(msg('A', 'confirmar'));
      const serialized = JSON.stringify(db.events);
      expect(serialized).not.toContain('mercado');
      // Nenhum campo novo de texto: so as colunas do schema (contrato secao 5).
      const allowed = ['id', 'userId', 'channel', 'messageId', 'intent', 'outcome', 'appliedKey', 'resultRef'];
      for (const event of db.events) {
        expect(Object.keys(event).every((key) => allowed.includes(key))).toBe(true);
      }
    });

    it('mensagem nao reconhecida grava UNRECOGNIZED sem texto', async () => {
      await service.handleMessage(msg('A', 'blablabla do meu cartao'));
      expect(db.events.at(-1)).toMatchObject({ outcome: ConversationOutcome.UNRECOGNIZED, intent: null });
      expect(JSON.stringify(db.events)).not.toContain('blablabla');
    });

    it('cancelar grava evento CANCELLED sem texto', async () => {
      await draftFor('A', '50 mercado');
      await service.handleMessage(msg('A', 'cancelar'));
      expect(db.events.at(-1)?.outcome).toBe(ConversationOutcome.CANCELLED);
    });
  });

  describe('getSession', () => {
    it('sem sessao devolve IDLE', async () => {
      await expect(service.getSession('A')).resolves.toEqual({ state: 'IDLE' });
    });

    it('com rascunho devolve estado e rascunho formatado', async () => {
      await draftFor('A', '50 mercado');
      const session = await service.getSession('A');
      expect(session.state).toBe(ConversationState.AWAITING_CONFIRMATION);
      expect(session.draft).toMatchObject({ amount: expect.stringMatching(/^R\$\s50,00$/), category: 'Mercado', draftVersion: 1 });
    });
  });
  describe('revisao: escolha numerica de categoria', () => {
    it('"2" escolhe a segunda opcao oferecida, nao vira gasto de R$ 2', async () => {
      db.categories.push({ id: 'cat-mercadinho', userId: 'A', name: 'Mercadinho', type: 'EXPENSE' });
      await service.handleMessage(msg('A', '50 merc'));

      const reply = await service.handleMessage(msg('A', '2'));

      expect(reply.kind).toBe('CONFIRM_DRAFT');
      expect(reply.draft?.category).toBe('Mercadinho');
      expect(reply.draft?.amount).toMatch(/^R\$\s50,00$/);
    });

    it('numero sem opcao correspondente nao escolhe categoria', async () => {
      db.categories.push({ id: 'cat-mercadinho', userId: 'A', name: 'Mercadinho', type: 'EXPENSE' });
      await service.handleMessage(msg('A', '50 merc'));

      const reply = await service.handleMessage(msg('A', '4'));

      expect(reply.kind).toBe('ASK_FIELD');
      expect(db.sessions[0].draft.categoryId).toBeNull();
    });
  });

  describe('revisao: escopo de userId e versao na reivindicacao', () => {
    it('a reivindicacao apaga so por id, userId e version', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];

      await service.confirmDraft('A', draft.id, draft.version);

      expect(db.prisma.conversationSession.deleteMany).toHaveBeenCalledWith({
        where: { id: draft.id, userId: 'A', version: draft.version },
      });
    });

    it('rascunho editado entre a leitura e a reivindicacao nao e aplicado (version no where)', async () => {
      await service.handleMessage(msg('A', '50'));
      const stale = structuredClone(db.sessions[0]);
      await service.handleMessage(msg('A', 'mercado'));
      expect(db.sessions[0].version).toBe(stale.version + 1);
      stale.state = ConversationState.AWAITING_CONFIRMATION;
      db.prisma.conversationSession.findFirst.mockResolvedValueOnce(stale);

      const reply = await service.confirmDraft('A', stale.id, stale.version);

      expect(reply?.kind).toBe('DUPLICATE');
      expect(transactions.create).not.toHaveBeenCalled();
      expect(db.sessions).toHaveLength(1);
    });

    it('o evento da confirmacao leva appliedKey sessao:versao e o id do lancamento', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];

      await service.confirmDraft('A', draft.id, draft.version);

      const applied = db.events.filter((event) => event.appliedKey);
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({
        userId: 'A',
        appliedKey: `${draft.id}:${draft.version}`,
        outcome: ConversationOutcome.COMPLETED,
        resultRef: 'tx-1',
      });
    });

    it('chave aplicada ja existente (sessao restaurada apos queda) bloqueia nova gravacao', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];
      db.events.push({ id: 'ev-old', userId: 'A', channel: 'APP', messageId: null, appliedKey: `${draft.id}:${draft.version}` });

      const reply = await service.confirmDraft('A', draft.id, draft.version);

      expect(reply?.kind).toBe('DUPLICATE');
      expect(transactions.create).not.toHaveBeenCalled();
    });
  });

  describe('revisao: reentrega concorrente da mesma messageId', () => {
    it('evento da mesma messageId gravado por outra requisicao nao perde a confirmacao', async () => {
      await draftFor('A', '50 mercado');
      const messageId = randomUUID();
      // Outra requisicao com a mesma messageId gravou o evento dela entre o check de duplicidade e a reivindicacao.
      db.events.push({ id: 'ev-other', userId: 'A', channel: 'APP', messageId, outcome: ConversationOutcome.UNRECOGNIZED, appliedKey: null });
      db.prisma.conversationEvent.findFirst.mockResolvedValueOnce(null);

      const reply = await service.handleMessage(msg('A', 'confirmar', T0, messageId));

      expect(reply.kind).toBe('DONE');
      expect(transactions.create).toHaveBeenCalledTimes(1);
      expect(db.events.filter((event) => event.appliedKey)).toHaveLength(1);
    });
  });

  describe('revisao: falha so da metrica depois de gravar', () => {
    it('erro ao fechar o evento nao vira excecao nem desfaz o lancamento', async () => {
      await draftFor('A', '50 mercado');
      const draft = db.sessions[0];
      db.prisma.conversationEvent.updateMany.mockRejectedValueOnce(new Error('banco caiu'));

      const reply = await service.confirmDraft('A', draft.id, draft.version);

      expect(reply?.kind).toBe('DONE');
      expect(transactions.create).toHaveBeenCalledTimes(1);
    });
  });
});
