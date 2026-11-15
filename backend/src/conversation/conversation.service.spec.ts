import { ConversationChannel, ConversationOutcome, ConversationState, Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
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
  let recurring: { list: jest.Mock };
  let installments: { list: jest.Mock };
  let goals: { list: jest.Mock };
  let service: ConversationService;
  let warn: jest.SpyInstance;

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  // Relógio travado em T0: os rascunhos nascem em T0 e a confirmação compara com o relógio real,
  // então sem isso os testes passam ou falham conforme a hora em que rodam.
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    // O log de falha de leitura não polui a saída dos testes; um teste confere o conteúdo.
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
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
    // Serviços de leitura: por padrão sem linhas. Cada teste substitui `list` quando precisa.
    recurring = { list: jest.fn(async () => []) };
    installments = { list: jest.fn(async () => []) };
    goals = { list: jest.fn(async () => []) };
    service = new ConversationService(
      db.prisma as unknown as Deps[0],
      dashboard as unknown as Deps[1],
      creditCycle as unknown as Deps[2],
      transactions as unknown as Deps[3],
      recurring as unknown as Deps[4],
      installments as unknown as Deps[5],
      goals as unknown as Deps[6],
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

  describe('valor que falta', () => {
    it('"gastei mercado" pergunta o valor, guarda a descrição e não manda ao Selah', async () => {
      const reply = await service.handleMessage(msg('A', 'gastei mercado'));

      expect(reply).toMatchObject({ kind: 'ASK_FIELD', state: 'COLLECTING_FIELDS' });
      expect(reply.unrecognized).toBeUndefined();
      expect(reply.draft).toMatchObject({ pendingField: 'amount', description: 'mercado' });
      expect(db.sessions).toHaveLength(1);
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('responder o valor completa o rascunho, com a categoria da descrição', async () => {
      await service.handleMessage(msg('A', 'gastei mercado'));

      const reply = await service.handleMessage(msg('A', '50'));

      expect(reply.kind).toBe('CONFIRM_DRAFT');
      expect(reply.draft).toMatchObject({ amount: expect.stringContaining('50,00'), description: 'mercado', category: 'Mercado' });
      expect(db.sessions[0].state).toBe('AWAITING_CONFIRMATION');
    });

    it('"recebi freelance" e depois "800" vira receita; categoria desconhecida pergunta uma vez', async () => {
      await service.handleMessage(msg('A', 'recebi freelance'));

      const afterAmount = await service.handleMessage(msg('A', '800'));
      expect(afterAmount.kind).toBe('ASK_FIELD');
      expect(afterAmount.draft).toMatchObject({ type: 'INCOME', description: 'freelance', pendingField: 'category' });

      const final = await service.handleMessage(msg('A', 'sem categoria'));
      expect(final.kind).toBe('CONFIRM_DRAFT');
      expect(final.draft).toMatchObject({ type: 'INCOME', amount: expect.stringContaining('800,00') });
    });

    it('"gastei" sozinho pede o valor; "32,90 padaria" traz valor e descrição de uma vez', async () => {
      const first = await service.handleMessage(msg('A', 'gastei'));
      expect(first.draft).toMatchObject({ pendingField: 'amount', description: null });

      const second = await service.handleMessage(msg('A', '32,90 padaria'));

      expect(second.kind).toBe('ASK_FIELD');
      expect(second.draft).toMatchObject({ description: 'padaria' });
    });

    it('valor inválido não derruba a conversa: erro claro e o rascunho continua esperando o valor', async () => {
      await service.handleMessage(msg('A', 'gastei mercado'));

      const text = await service.handleMessage(msg('A', 'abc'));
      const zero = await service.handleMessage(msg('A', '0'));

      expect(text.kind).toBe('ERROR');
      expect(zero.kind).toBe('ERROR');
      expect(db.sessions).toHaveLength(1);
      expect((db.sessions[0].draft as any).pendingField).toBe('amount');

      const ok = await service.handleMessage(msg('A', '50'));
      expect(ok.kind).toBe('CONFIRM_DRAFT');
    });

    it('uma leitura (saldo) durante a espera do valor responde e mantém o rascunho', async () => {
      await service.handleMessage(msg('A', 'gastei mercado'));

      const reply = await service.handleMessage(msg('A', 'saldo'));

      expect(reply.kind).toBe('INFO');
      expect((db.sessions[0].draft as any).pendingField).toBe('amount');
    });

    it('rascunho sem valor não pode ser confirmado por botão nem por texto', async () => {
      await service.handleMessage(msg('A', 'gastei mercado'));
      const draft = db.sessions[0];

      const byButton = await service.confirmDraft('A', draft.id, draft.version);
      const byText = await service.handleMessage(msg('A', 'confirmar'));

      expect(byButton).toBeNull();
      expect(byText.kind).not.toBe('DONE');
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
      expect(reply.unrecognized).toBeUndefined();
      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('texto livre marca unrecognized; "ajuda" nao', async () => {
      const free = await service.handleMessage(msg('A', 'analise meus gastos do mes'));
      const help = await service.handleMessage(msg('A', 'ajuda'));

      expect(free).toMatchObject({ kind: 'HELP', unrecognized: true });
      expect(help.kind).toBe('HELP');
      expect(help.unrecognized).toBeUndefined();
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

    it('gastos com categoria usa o mes do fuso do usuario, do dia 1 UTC ate o fim de hoje', async () => {
      jest.useFakeTimers({ now: T0 });
      try {
        await service.handleMessage(msg('A', 'gastos com mercado'));
      } finally {
        jest.useRealTimers();
      }

      const [args] = db.prisma.transaction.groupBy.mock.calls[0] as any[];
      expect(args.where.userId).toBe('A');
      expect(args.where.date.gte).toEqual(new Date('2026-11-01T00:00:00.000Z'));
      expect(args.where.date.lt).toEqual(new Date('2026-11-16T00:00:00.000Z'));
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

  describe('consultas de finanças (item 3a)', () => {
    const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    /** Conta fixa padrão: aluguel mensal de despesa, ativa, vence em 01/12. */
    const bill = (o: Row = {}): Row => ({
      description: 'Aluguel',
      type: 'EXPENSE',
      frequency: 'MONTHLY',
      amount: 1500,
      isActive: true,
      nextDueDate: day('2026-12-01'),
      ...o,
    });
    /** Parcelado padrão: notebook, parcela 3 de 10 (2 geradas), 8 restantes. */
    const inst = (o: Row = {}): Row => ({
      description: 'Notebook',
      installmentAmount: 450,
      installmentsTotal: 10,
      installmentsGenerated: 2,
      remainingAmount: 3600,
      remainingInstallments: 8,
      isActive: true,
      nextDueDate: day('2026-12-05'),
      ...o,
    });
    const goal = (o: Row = {}): Row => ({
      title: 'Viagem',
      status: 'ACTIVE',
      targetAmount: 1000,
      currentAmount: 333.33,
      targetDate: day('2027-06-30'),
      ...o,
    });
    // Intl pt-BR põe NBSP entre "R$" e o valor; os textos esperados usam espaço comum.
    const ask = async (text: string, userId = 'A', receivedAt: Date = T0) => {
      const reply = await service.handleMessage(msg(userId, text, receivedAt));
      return { ...reply, text: reply.text.replace(/\u00a0/g, ' ') };
    };

    describe('contas fixas (fixed_bills)', () => {
      it('caso vazio', async () => {
        const reply = await ask('contas fixas');
        expect(reply.kind).toBe('INFO');
        expect(reply.text).toBe('Você ainda não tem contas fixas ativas.');
      });

      it('filtra inativas e receitas, ordena por vencimento e soma o total mensal estimado', async () => {
        recurring.list = jest.fn(async () => [
          bill({ description: 'Anual', frequency: 'YEARLY', amount: 1200, nextDueDate: day('2027-03-01') }),
          bill({ description: 'Semanal', frequency: 'WEEKLY', amount: 50, nextDueDate: day('2026-11-18') }),
          bill({ description: 'Aluguel' }),
          bill({ description: 'Desativada', isActive: false }),
          bill({ description: 'Salário', type: 'INCOME', amount: 3000 }),
        ]);
        const reply = await ask('contas fixas');
        // 1500 + 50 x 52 / 12 + 1200 / 12 = 1816,666... -> arredonda uma vez: 1.816,67
        expect(reply.data?.totalCents).toBe(181667);
        expect(reply.text).toBe(
          [
            'Contas fixas ativas (3):',
            '• Semanal: R$ 50,00, semanal, próximo em 18/11',
            '• Aluguel: R$ 1.500,00, mensal, próximo em 01/12',
            '• Anual: R$ 1.200,00, anual, próximo em 01/03',
            'Total mensal estimado: R$ 1.816,67.',
          ].join('\n'),
        );
        expect(recurring.list).toHaveBeenCalledWith('A');
      });

      it('total mensal arredonda uma vez, em meio centavo sobe: anual de R$ 0,42 vale 3,5 centavos por mês', async () => {
        recurring.list = jest.fn(async () => [bill({ frequency: 'YEARLY', amount: 0.42 })]);
        const reply = await ask('contas fixas');
        expect(reply.data?.totalCents).toBe(4);
      });

      it('mais de 5 itens: mostra 5 e diz quantos ficaram de fora', async () => {
        recurring.list = jest.fn(async () =>
          Array.from({ length: 7 }, (_, index) => bill({ description: `Conta ${index}` })),
        );
        const reply = await ask('contas fixas');
        expect(reply.text).toContain('Contas fixas ativas (7):');
        expect(reply.text.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(5);
        expect(reply.text).toContain('e mais 2.');
      });

      it('descrição longa é cortada em 60 caracteres com "…"', async () => {
        recurring.list = jest.fn(async () => [bill({ description: 'x'.repeat(80) })]);
        const reply = await ask('contas fixas');
        expect(reply.text).toContain(`• ${'x'.repeat(59)}…: `);
      });
    });

    describe('parcelas (installments)', () => {
      it('caso vazio', async () => {
        const reply = await ask('minhas parcelas');
        expect(reply.text).toBe('Você não tem compras parceladas em aberto.');
      });

      it('ignora quitadas e inativas; "parcela X de N" e total a pagar', async () => {
        installments.list = jest.fn(async () => [
          inst({ description: 'Sofá', installmentAmount: 300, installmentsTotal: 6, installmentsGenerated: 0, remainingAmount: 1800, remainingInstallments: 6, nextDueDate: day('2026-12-20') }),
          inst({ description: 'Quitada', installmentsTotal: 2, installmentsGenerated: 2, remainingAmount: 0, remainingInstallments: 0, nextDueDate: null }),
          inst({ description: 'Desativada', isActive: false }),
          inst(),
        ]);
        const reply = await ask('parcelas');
        expect(reply.text).toBe(
          [
            'Parcelas em aberto (2):',
            '• Notebook: parcela 3 de 10, R$ 450,00, próxima em 05/12',
            '• Sofá: parcela 1 de 6, R$ 300,00, próxima em 20/12',
            'A pagar ao todo: R$ 5.400,00. Próximo impacto: R$ 450,00 em 05/12.',
          ].join('\n'),
        );
        expect(reply.data?.totalCents).toBe(540000);
      });

      it('próximo impacto é a parcela de data mais próxima, mesmo vindo depois na lista', async () => {
        installments.list = jest.fn(async () => [
          inst({ description: 'Longe', installmentAmount: 100, nextDueDate: day('2027-01-10') }),
          inst({ description: 'Perto', installmentAmount: 77, nextDueDate: day('2026-11-25') }),
        ]);
        const reply = await ask('parcelas');
        expect(reply.text).toContain('Próximo impacto: R$ 77,00 em 25/11.');
      });

      it('última parcela usa o restante (absorve a sobra do arredondamento)', async () => {
        installments.list = jest.fn(async () => [
          inst({ installmentAmount: 100, installmentsTotal: 3, installmentsGenerated: 2, remainingAmount: 150, remainingInstallments: 1 }),
        ]);
        const reply = await ask('parcelas');
        expect(reply.data?.installments?.[0].amountCents).toBe(15000);
        expect(reply.text).toContain('R$ 150,00');
      });

      it('mais de 5 itens: mostra 5 e diz quantos ficaram de fora; total usa todos', async () => {
        installments.list = jest.fn(async () =>
          Array.from({ length: 6 }, (_, index) => inst({ description: `Item ${index}`, remainingAmount: 100, nextDueDate: day('2026-12-05') })),
        );
        const reply = await ask('parcelas');
        expect(reply.text).toContain('Parcelas em aberto (6):');
        expect(reply.text.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(5);
        expect(reply.text).toContain('e mais 1.');
        expect(reply.data?.totalCents).toBe(60000);
      });
    });

    describe('vencimentos (upcoming_dues)', () => {
      it('caso vazio', async () => {
        const reply = await ask('o que vence');
        expect(reply.text).toBe('Nada vence nos próximos 30 dias.');
      });

      it('janela: dia 29 entra, dia 30 não (hoje = 15/11 no fuso do usuário)', async () => {
        recurring.list = jest.fn(async () => [
          bill({ description: 'Dia 29', nextDueDate: day('2026-12-14') }),
          bill({ description: 'Dia 30', nextDueDate: day('2026-12-15') }),
          bill({ description: 'Hoje', nextDueDate: day('2026-11-15') }),
          bill({ description: 'Ontem', nextDueDate: day('2026-11-14') }),
        ]);
        const reply = await ask('o que vence');
        expect(reply.text).toContain('Dia 29');
        expect(reply.text).toContain('Hoje');
        expect(reply.text).not.toContain('Dia 30');
        expect(reply.text).not.toContain('Ontem');
      });

      it('usa o dia do fuso do usuário, não o UTC (23h em São Paulo ainda é o dia 15)', async () => {
        recurring.list = jest.fn(async () => [bill({ description: 'Dia 30 UTC', nextDueDate: day('2026-12-15') })]);
        const reply = await ask('o que vence', 'A', new Date('2026-11-16T02:00:00.000Z'));
        expect(reply.text).toBe('Nada vence nos próximos 30 dias.');
      });

      it('mistura conta fixa e parcela por data, ordem por data e empate por valor decrescente', async () => {
        recurring.list = jest.fn(async () => [
          bill({ description: 'Luz', amount: 200, nextDueDate: day('2026-11-20') }),
        ]);
        installments.list = jest.fn(async () => [
          inst({ description: 'Celular', installmentAmount: 350, installmentsGenerated: 4, installmentsTotal: 12, nextDueDate: day('2026-11-20') }),
          inst({ description: 'Sofá', installmentAmount: 300, installmentsGenerated: 0, installmentsTotal: 6, nextDueDate: day('2026-11-18') }),
        ]);
        const reply = await ask('vencimentos');
        expect(reply.text).toBe(
          [
            'Vencimentos nos próximos 30 dias (3):',
            '• 18/11: Sofá, R$ 300,00 (parcela 1/6)',
            '• 20/11: Celular, R$ 350,00 (parcela 5/12)',
            '• 20/11: Luz, R$ 200,00 (conta fixa)',
            'Total da janela: R$ 850,00.',
          ].join('\n'),
        );
        expect(reply.data?.totalCents).toBe(85000);
      });

      it('ignora receita, conta inativa, parcelado inativo e parcelado quitado, mesmo com data na janela', async () => {
        recurring.list = jest.fn(async () => [
          bill({ description: 'Luz', amount: 200, nextDueDate: day('2026-11-20') }),
          bill({ description: 'Salário', type: 'INCOME', amount: 3000, nextDueDate: day('2026-11-20') }),
          bill({ description: 'Conta parada', isActive: false, nextDueDate: day('2026-11-20') }),
        ]);
        installments.list = jest.fn(async () => [
          inst({ description: 'Sofá', installmentAmount: 300, nextDueDate: day('2026-11-21') }),
          inst({ description: 'Parcelado parado', isActive: false, nextDueDate: day('2026-11-21') }),
          inst({ description: 'Quitado', remainingInstallments: 0, remainingAmount: 0, nextDueDate: day('2026-11-21') }),
        ]);
        const reply = await ask('o que vence');
        expect(reply.text).toContain('Luz');
        expect(reply.text).toContain('Sofá');
        for (const out of ['Salário', 'Conta parada', 'Parcelado parado', 'Quitado']) {
          expect(reply.text).not.toContain(out);
        }
        expect(reply.data?.totalCents).toBe(50000);
      });

      it('conta semanal aparece uma vez (só o próximo vencimento)', async () => {
        recurring.list = jest.fn(async () => [
          bill({ description: 'Feira', frequency: 'WEEKLY', amount: 80, nextDueDate: day('2026-11-18') }),
        ]);
        const reply = await ask('o que vence');
        expect(reply.text.match(/Feira/g)).toHaveLength(1);
        expect(reply.data?.totalCents).toBe(8000);
      });

      it('mais de 8 itens: mostra 8 e diz quantos ficaram de fora', async () => {
        recurring.list = jest.fn(async () =>
          Array.from({ length: 9 }, (_, index) => bill({ description: `Conta ${index}`, nextDueDate: day('2026-11-20') })),
        );
        const reply = await ask('o que vence');
        expect(reply.text.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(8);
        expect(reply.text).toContain('e mais 1.');
      });

      it('descrição longa é cortada em 60 caracteres com "…"', async () => {
        recurring.list = jest.fn(async () => [bill({ description: 'y'.repeat(70), nextDueDate: day('2026-11-20') })]);
        const reply = await ask('o que vence');
        expect(reply.text).toContain(`${'y'.repeat(59)}…, R$`);
      });
    });

    describe('metas (goals)', () => {
      it('caso vazio', async () => {
        const reply = await ask('metas');
        expect(reply.text).toBe('Você ainda não tem metas ativas.');
      });

      it('mostra só ativas, ordenadas por prazo com sem data por último', async () => {
        goals.list = jest.fn(async () => [
          goal({ title: 'Sem prazo', targetDate: null }),
          goal({ title: 'Tardia', targetDate: day('2027-12-31') }),
          goal({ title: 'Cedo', targetDate: day('2027-01-31') }),
          goal({ title: 'Pausada', status: 'PAUSED' }),
        ]);
        const reply = await ask('minhas metas');
        const order = reply.text.split('\n').filter((line) => line.startsWith('• ')).map((line) => line.slice(2, line.indexOf(':')));
        expect(order).toEqual(['Cedo', 'Tardia', 'Sem prazo']);
        expect(reply.text).toContain('Você tem 1 meta(s) pausada(s), planejada(s) ou concluída(s).');
      });

      it('percentual com floor: 333,33 de 1000 vira 33%; 999,99 de 1000 vira 99%', async () => {
        goals.list = jest.fn(async () => [
          goal({ title: 'A', currentAmount: 333.33 }),
          goal({ title: 'B', currentAmount: 999.99 }),
        ]);
        const reply = await ask('metas');
        expect(reply.text).toContain('• A: R$ 333,33 guardados de R$ 1.000,00 (33%)');
        expect(reply.text).toContain('• B: R$ 999,99 guardados de R$ 1.000,00 (99%)');
      });

      it('teto de 100% e falta zerada quando já passou do alvo', async () => {
        goals.list = jest.fn(async () => [goal({ title: 'Cheia', targetAmount: 100, currentAmount: 250, targetDate: null })]);
        const reply = await ask('metas');
        expect(reply.text).toBe(
          [
            'Metas ativas (1):',
            '• Cheia: R$ 250,00 guardados de R$ 100,00 (100%), falta R$ 0,00',
          ].join('\n'),
        );
        expect(reply.data?.goals?.[0].percent).toBe(100);
      });

      it('cofrinho sem alvo mostra o guardado', async () => {
        goals.list = jest.fn(async () => [goal({ title: 'Reserva', targetAmount: null, currentAmount: 500, targetDate: null })]);
        const reply = await ask('reservas');
        expect(reply.text).toContain('• Reserva: R$ 500,00 guardados (sem alvo)');
      });

      it('aviso de metas fora da lista aparece mesmo sem nenhuma ativa', async () => {
        goals.list = jest.fn(async () => [goal({ status: 'PLANNED' }), goal({ status: 'ACHIEVED' })]);
        const reply = await ask('metas');
        expect(reply.text).toBe(
          ['Você ainda não tem metas ativas.', 'Você tem 2 meta(s) pausada(s), planejada(s) ou concluída(s).'].join('\n'),
        );
      });

      it('mais de 5 metas: mostra 5 e diz quantas ficaram de fora', async () => {
        goals.list = jest.fn(async () => Array.from({ length: 6 }, (_, index) => goal({ title: `M${index}` })));
        const reply = await ask('metas');
        expect(reply.text).toContain('e mais 1.');
      });
    });

    describe('isolamento e falha', () => {
      it('cada consulta usa o userId do motor e nunca mostra item de outra conta', async () => {
        const forA = (rows: Row[]) => jest.fn(async (userId: string) => (userId === 'A' ? rows : [{ ...rows[0], description: 'DO B' }]));
        recurring.list = forA([bill({ description: 'DA A', nextDueDate: day('2026-11-20') })]);
        installments.list = forA([inst({ description: 'DA A' })]);
        goals.list = forA([goal({ title: 'DA A' })]);

        for (const text of ['contas fixas', 'parcelas', 'o que vence', 'metas']) {
          const reply = await ask(text, 'A');
          expect(reply.text).toContain('DA A');
          expect(reply.text).not.toContain('DO B');
        }
        expect(recurring.list.mock.calls.every(([id]) => id === 'A')).toBe(true);
        expect(installments.list.mock.calls.every(([id]) => id === 'A')).toBe(true);
        expect(goals.list.mock.calls.every(([id]) => id === 'A')).toBe(true);
      });

      it('falha de serviço vira ERROR genérico, sem texto interno, e evento ERROR', async () => {
        recurring.list = jest.fn(async () => {
          throw new Error('connection to db at 10.0.0.5 refused');
        });
        const reply = await ask('contas fixas');
        expect(reply).toEqual({ kind: 'ERROR', state: 'IDLE', text: 'Não consegui consultar agora. Tente de novo.' });
        expect(JSON.stringify(reply)).not.toContain('10.0.0.5');
        expect(db.events.at(-1)).toMatchObject({ intent: 'fixed_bills', outcome: ConversationOutcome.ERROR });
      });

      it('falha de leitura registra no log só o id da intenção e o nome do erro, nunca a mensagem', async () => {
        class BancoFora extends Error {
          name = 'BancoFora';
        }
        goals.list = jest.fn(async () => {
          throw new BancoFora('senha=abc123 saldo R$ 9.999,00 na conta de Fulano');
        });
        await ask('minhas metas que Fulano guardou');
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = String(warn.mock.calls[0][0]);
        expect(logged).toContain('goals');
        expect(logged).toContain('BancoFora');
        for (const secret of ['abc123', '9.999', 'Fulano', 'metas que']) {
          expect(logged).not.toContain(secret);
        }
      });

      it('falha de leitura antiga (balance) também vira ERROR genérico', async () => {
        dashboard.getSummary.mockRejectedValueOnce(new Error('segredo interno'));
        const reply = await ask('saldo');
        expect(reply.kind).toBe('ERROR');
        expect(reply.text).toBe('Não consegui consultar agora. Tente de novo.');
        expect(JSON.stringify(reply)).not.toContain('segredo');
      });

      it('leitura não grava nada e registra evento RECOGNIZED sem texto', async () => {
        recurring.list = jest.fn(async () => [bill({ nextDueDate: day('2026-11-20') })]);
        await ask('o que vence');
        expect(transactions.create).not.toHaveBeenCalled();
        expect(db.events.at(-1)).toMatchObject({ intent: 'upcoming_dues', outcome: ConversationOutcome.RECOGNIZED });
        expect(JSON.stringify(db.events)).not.toContain('Aluguel');
      });

      it('leitura durante rascunho em coleta mantém o rascunho', async () => {
        await service.handleMessage(msg('A', 'gastei mercado'));
        expect((await service.getSession('A')).state).toBe('COLLECTING_FIELDS');

        const reply = await ask('metas');
        expect(reply.kind).toBe('INFO');
        expect(reply.state).toBe('COLLECTING_FIELDS');

        const session = await service.getSession('A');
        expect(session.state).toBe('COLLECTING_FIELDS');
        expect(session.draft?.pendingField).toBe('amount');
      });
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
