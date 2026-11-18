import { ConversationChannel, ConversationOutcome, ConversationState, Prisma } from '@prisma/client';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PlanLimitException } from '../billing/plan-limit.exception';
import { ConversationInput } from './conversation.types';
import { ConversationService } from './conversation.service';
import { REPLIES, formatBrl } from './replies';
import { EnvelopeMonthChangedError, EnvelopeWriteUncertainError } from '../envelopes/conversation-write.types';
import { CreditLimitChangedError, CreditLimitWriteUncertainError } from '../credit-cycle/conversation-write.types';
import { RecurringFirstDueChangedError, RecurringWriteUncertainError } from '../recurring-transactions/conversation-write.types';
import { InstallmentFirstDueChangedError, InstallmentWriteUncertainError } from '../installments/conversation-write.types';

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
    envelope: {
      // Nome exato por dono (unicidade userId + name). Os testes trocam o retorno quando precisam.
      findFirst: jest.fn(async () => null),
    },
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
  let creditCycle: { getCurrent: jest.Mock; setCeilingForConversation?: jest.Mock };
  let recurring: { list: jest.Mock; createForConversation: jest.Mock };
  let installments: { list: jest.Mock; createForConversation: jest.Mock };
  let goals: { list: jest.Mock; create: jest.Mock; contribute: jest.Mock };
  let envelopes: { list: jest.Mock; createForConversation: jest.Mock };
  let entitlements: { assertCanCreate: jest.Mock };
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
    recurring = {
      list: jest.fn(async () => []),
      createForConversation: jest.fn(async (_userId: string, dto: any, _rules: unknown) => ({
        id: 'rec-9',
        description: dto.description,
        amountCents: Math.round(dto.amount * 100),
        frequency: dto.frequency,
        firstDueDate: dto.firstDueDate,
        materializationPending: false,
        refreshPending: false,
      })),
    };
    installments = {
      list: jest.fn(async () => []),
      createForConversation: jest.fn(async (_userId: string, dto: any, _rules: unknown) => ({
        id: 'inst-9',
        description: dto.description,
        totalCents: Math.round(dto.totalAmount * 100),
        installmentsTotal: dto.installmentsTotal,
        installmentCents: Math.round((dto.totalAmount / dto.installmentsTotal) * 100),
        lastInstallmentCents: 0,
        firstDueDate: dto.firstDueDate,
        materializationPending: false,
        refreshPending: false,
      })),
    };
    goals = {
      list: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: 'goal-new', title: 'Viagem', status: 'ACTIVE', targetAmount: 3000, currentAmount: 0 })),
      contribute: jest.fn(async () => ({ id: 'goal-1', title: 'Viagem', status: 'ACTIVE', targetAmount: 3000, currentAmount: 1400 })),
    };
    envelopes = { list: jest.fn(async () => []), createForConversation: jest.fn(async () => ({})) };
    entitlements = { assertCanCreate: jest.fn(async () => undefined) };
    service = new ConversationService(
      db.prisma as unknown as Deps[0],
      dashboard as unknown as Deps[1],
      creditCycle as unknown as Deps[2],
      transactions as unknown as Deps[3],
      recurring as unknown as Deps[4],
      installments as unknown as Deps[5],
      goals as unknown as Deps[6],
      envelopes as unknown as Deps[7],
      entitlements as unknown as Deps[8],
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
      expect(reply.draft?.rows).toContainEqual({ label: 'Aviso', value: 'Este lançamento tem data futura.' });
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

    it('"importar nota" orienta e indica a tela, sem rascunho nem sessao (item 4c)', async () => {
      const reply = await service.handleMessage(msg('A', 'importar nota'));

      expect(reply).toMatchObject({ kind: 'HELP', state: 'IDLE', data: { screen: 'imports' } });
      expect(reply.text).toContain('abra Importações');
      expect(reply.draft).toBeUndefined();
      expect(reply.unrecognized).toBeUndefined();
      expect(db.sessions).toHaveLength(0);
      expect(transactions.create).not.toHaveBeenCalled();
      expect(db.events.at(-1)).toMatchObject({ intent: 'import_receipt', outcome: ConversationOutcome.RECOGNIZED });
    });

    it('"importar nota" com rascunho em andamento nao mexe no rascunho (item 4c)', async () => {
      await draftFor('A', '50 mercado');
      const before = JSON.stringify(db.sessions);

      const reply = await service.handleMessage(msg('A', 'importar nota'));

      expect(reply).toMatchObject({ kind: 'HELP', data: { screen: 'imports' } });
      expect(reply.state).not.toBe('IDLE');
      expect(JSON.stringify(db.sessions)).toBe(before);
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
        const reply = await ask('metas');
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

  describe('metas e aportes por conversa (contrato 3b1)', () => {
    /** Meta do banco fake. userId padrao = A (dono da conta do teste). */
    const goalRow = (o: Row = {}): Row => ({
      id: 'goal-1',
      userId: 'A',
      title: 'Viagem',
      status: 'ACTIVE',
      targetAmount: 3000,
      currentAmount: 1200,
      targetDate: null,
      ...o,
    });
    /** Lista de metas como o serviço devolve. Devolve tudo, mesmo de outra conta: o motor deve filtrar. */
    const setGoals = (rows: Row[]) => {
      goals.list = jest.fn(async () => rows);
    };
    const text = (reply: { text: string }) => reply.text;
    const limitError = () =>
      new PlanLimitException({ resource: 'goals', limit: 2, used: 2, plan: 'FREE' });

    describe('criar meta', () => {
      it('"criar meta viagem 3 mil" abre rascunho com nome e alvo, sem gravar', async () => {
        const reply = await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.draft).toMatchObject({ kind: 'GOAL', title: 'Meta', pendingField: null });
        expect(reply.draft?.rows).toEqual([
          { label: 'Nome', value: 'viagem' },
          { label: 'Alvo', value: 'R$ 3.000,00' },
        ]);
        expect(text(reply)).toContain('Rascunho de meta:\nNome: viagem\nAlvo: R$ 3.000,00');
        expect(goals.create).not.toHaveBeenCalled();
        expect(db.sessions[0].draft.targetCents).toBe(300_000);
      });

      it('confirmar grava com o userId do motor e responde DONE com o id', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('DONE');
        expect(reply.text).toBe('Meta criada: viagem, alvo R$ 3.000,00.');
        expect(reply.data).toEqual({ goalId: 'goal-new' });
        expect(goals.create).toHaveBeenCalledTimes(1);
        expect(goals.create).toHaveBeenCalledWith('A', { title: 'viagem', targetAmount: 3000 });
        expect(db.sessions).toHaveLength(0);
      });

      it('só o nome pergunta o alvo; "sem alvo" fecha como cofrinho', async () => {
        const ask = await service.handleMessage(msg('A', 'criar meta viagem'));
        expect(ask.kind).toBe('ASK_FIELD');
        expect(text(ask)).toContain(REPLIES.askGoalTarget);
        expect(ask.draft?.pendingField).toBe('target');

        const draft = await service.handleMessage(msg('A', 'sem alvo'));
        expect(draft.kind).toBe('CONFIRM_DRAFT');
        expect(text(draft)).toContain('Alvo: sem alvo (cofrinho)');
        expect(draft.draft?.rows).toContainEqual({ label: 'Alvo', value: 'sem alvo (cofrinho)' });

        await service.handleMessage(msg('A', 'confirmar'));
        expect(goals.create).toHaveBeenCalledWith('A', { title: 'viagem', targetAmount: undefined });
      });

      it('"nova meta" pergunta nome, depois alvo; "3 mil" é valor, não nome', async () => {
        const first = await service.handleMessage(msg('A', 'nova meta'));
        expect(text(first)).toContain(REPLIES.askGoalTitle);
        const second = await service.handleMessage(msg('A', 'casa'));
        expect(second.kind).toBe('ASK_FIELD');
        expect(text(second)).toContain(REPLIES.askGoalTarget);
        const third = await service.handleMessage(msg('A', '1500'));
        expect(third.kind).toBe('CONFIRM_DRAFT');
        expect(text(third)).toContain('Alvo: R$ 1.500,00');
      });

      it('"criar cofrinho emergência" já abre o rascunho sem alvo, sem perguntar o alvo', async () => {
        const reply = await service.handleMessage(msg('A', 'criar cofrinho emergência'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(text(reply)).toContain('Nome: emergência\nAlvo: sem alvo (cofrinho)');
        expect(db.sessions[0].draft).toMatchObject({ kind: 'GOAL', title: 'emergência', targetCents: null, noTarget: true, pendingField: null });

        const done = await service.handleMessage(msg('A', 'confirmar'));
        expect(done.text).toBe('Cofrinho criado: emergência.');
        expect(goals.create).toHaveBeenCalledWith('A', { title: 'emergência', targetAmount: undefined });
      });

      it('"criar cofrinho viagem de 2027": o número é parte do nome, não vira alvo', async () => {
        const reply = await service.handleMessage(msg('A', 'criar cofrinho viagem de 2027'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.draft?.rows).toEqual([
          { label: 'Nome', value: 'viagem de 2027' },
          { label: 'Alvo', value: 'sem alvo (cofrinho)' },
        ]);
      });

      it('"criar cofrinho" sozinho pergunta só o nome e depois fecha sem pedir o alvo', async () => {
        const ask = await service.handleMessage(msg('A', 'criar cofrinho'));
        expect(ask.draft?.pendingField).toBe('title');
        const draft = await service.handleMessage(msg('A', 'reserva de emergência'));
        expect(draft.kind).toBe('CONFIRM_DRAFT');
        expect(text(draft)).toContain('Alvo: sem alvo (cofrinho)');
      });

      it('"criar meta casa" continua perguntando o alvo (só cofrinho nasce sem alvo)', async () => {
        const reply = await service.handleMessage(msg('A', 'criar meta casa'));
        expect(reply.kind).toBe('ASK_FIELD');
        expect(reply.draft?.pendingField).toBe('target');
      });

      it('"criar meta de viagem" tira o conector do nome', async () => {
        const reply = await service.handleMessage(msg('A', 'criar meta de viagem'));
        expect(reply.draft?.rows[0]).toEqual({ label: 'Nome', value: 'viagem' });
      });

      it('nome vazio pergunta o nome (pendingField title)', async () => {
        const reply = await service.handleMessage(msg('A', 'criar meta'));
        expect(reply.kind).toBe('ASK_FIELD');
        expect(text(reply)).toContain(REPLIES.askGoalTitle);
        expect(reply.draft?.pendingField).toBe('title');
      });

      it('nome com 1 caractere pede de novo; nome com mais de 60 recusa sem mudar o rascunho', async () => {
        await service.handleMessage(msg('A', 'criar meta'));
        const short = await service.handleMessage(msg('A', 'x'));
        expect(text(short)).toContain(REPLIES.askGoalTitle);
        const long = await service.handleMessage(msg('A', 'a'.repeat(61)));
        expect(long.kind).toBe('ERROR');
        expect(text(long)).toBe(REPLIES.goalTitleTooLong);
        expect(db.sessions[0].state).toBe(ConversationState.COLLECTING_FIELDS);
      });

      it('nome igual ao de meta ativa recusa ao abrir e não abre rascunho', async () => {
        setGoals([goalRow({ title: 'Viagem' })]);
        const reply = await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.goalNameTaken);
        expect(db.sessions).toHaveLength(0);
      });

      it('limite do plano recusa ao abrir, com a mensagem da exceção, e não abre rascunho', async () => {
        entitlements.assertCanCreate.mockRejectedValueOnce(limitError());
        const reply = await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(limitError().message);
        expect(entitlements.assertCanCreate).toHaveBeenCalledWith('A', 'goals');
        expect(db.sessions).toHaveLength(0);
      });

      it('limite surgindo entre abrir e confirmar: recusa, descarta o rascunho e não volta em loop', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        goals.create.mockRejectedValueOnce(limitError());
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(limitError().message);
        expect(db.sessions).toHaveLength(0);
        const again = await service.handleMessage(msg('A', 'confirmar'));
        expect(again.kind).toBe('HELP');
        expect(goals.create).toHaveBeenCalledTimes(1);
      });

      it('erro 4xx do serviço ao confirmar descarta o rascunho', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        goals.create.mockRejectedValueOnce(new NotFoundException('x'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('ERROR');
        expect(db.sessions).toHaveLength(0);
      });

      it('valor ambíguo ("1,234") pede correção e não abre rascunho', async () => {
        const reply = await service.handleMessage(msg('A', 'criar meta viagem 1,234'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.amountAmbiguous);
        expect(db.sessions).toHaveLength(0);
      });

      it('falha inesperada em GoalsService.create restaura o rascunho', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        goals.create.mockRejectedValueOnce(new Error('banco caiu'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.goalSaveFailed);
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0].state).toBe(ConversationState.AWAITING_CONFIRMATION);
      });

      it('evento da confirmação de meta leva appliedKey sessao:versao e o id da meta criada', async () => {
        const draft = await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        await service.handleMessage(msg('A', 'confirmar'));
        const event = db.events.find((row) => row.outcome === ConversationOutcome.COMPLETED);
        expect(event).toMatchObject({ intent: 'create_goal', resultRef: 'goal-new' });
        expect(event?.appliedKey).toBe(`${draft.draft?.draftId}:${draft.draft?.draftVersion}`);
      });

      it('rascunho de meta ainda em coleta não confirma por botão nem por texto', async () => {
        const ask = await service.handleMessage(msg('A', 'criar meta viagem'));
        expect(ask.kind).toBe('ASK_FIELD');
        const byButton = await service.confirmDraft('A', ask.draft!.draftId, ask.draft!.draftVersion);
        expect(byButton).toBeNull();
        await service.handleMessage(msg('A', 'confirmar'));
        expect(goals.create).not.toHaveBeenCalled();
        expect(db.sessions).toHaveLength(1);
      });

      it('duas confirmações em paralelo chamam GoalsService.create uma vez', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        const [first, second] = await Promise.all([
          service.handleMessage(msg('A', 'confirmar')),
          service.handleMessage(msg('A', 'confirmar')),
        ]);
        expect([first.kind, second.kind].filter((kind) => kind === 'DONE')).toHaveLength(1);
        expect(goals.create).toHaveBeenCalledTimes(1);
      });

      it('confirmação com versão antiga é recusada (botão)', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        const session = db.sessions[0];
        const reply = await service.confirmDraft('A', session.id, session.version + 1);
        expect(reply).toBeNull();
        expect(goals.create).not.toHaveBeenCalled();
      });

      it('rascunho de meta expira em 15 minutos sem mensagem', async () => {
        await service.handleMessage(msg('A', 'criar meta'));
        const reply = await service.handleMessage(msg('A', 'viagem', new Date(T0.getTime() + 15 * 60_000 + 1000)));
        expect(reply.kind).toBe('EXPIRED');
      });

      it('leitura durante rascunho de meta responde e mantém o rascunho', async () => {
        await service.handleMessage(msg('A', 'criar meta'));
        const before = db.sessions[0].version;
        const reply = await service.handleMessage(msg('A', 'saldo'));
        expect(reply.kind).toBe('INFO');
        expect(db.sessions[0].version).toBe(before);
      });

      it('comando de meta com rascunho de lançamento em coleta não substitui o rascunho', async () => {
        await service.handleMessage(msg('A', 'gastei mercado'));
        const reply = await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        expect(text(reply)).toContain(REPLIES.collectingReminder);
        expect(db.sessions[0].intent).toBe('create_expense');
      });
    });

    describe('aporte', () => {
      it('meta única é usada sem perguntar; o rascunho mostra meta, valor e data', async () => {
        setGoals([goalRow()]);
        const reply = await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(text(reply)).toContain(
          'Rascunho de aporte:\nMeta: Viagem (R$ 1.200,00 de R$ 3.000,00)\nValor: R$ 200,00\nData: 15/11/2026',
        );
        expect(reply.draft?.rows).toEqual([
          { label: 'Meta', value: 'Viagem (R$ 1.200,00 de R$ 3.000,00)' },
          { label: 'Valor', value: 'R$ 200,00' },
          { label: 'Data', value: '15/11/2026' },
        ]);
        expect(goals.contribute).not.toHaveBeenCalled();
      });

      it('confirmar chama contribute com o userId do motor, o id da meta e a data do dia', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('DONE');
        expect(goals.contribute).toHaveBeenCalledTimes(1);
        expect(goals.contribute).toHaveBeenCalledWith('A', 'goal-1', {
          amount: 200,
          date: '2026-11-15T00:00:00.000Z',
          createTransaction: true,
        });
        expect(reply.text).toBe('Aporte feito: R$ 200,00 em Viagem. Agora R$ 1.400,00 de R$ 3.000,00 (46%).');
        expect(reply.data).toEqual({ goalId: 'goal-1' });
      });

      it('várias metas: pergunta com opções numeradas; "2" escolhe a segunda', async () => {
        setGoals([goalRow({ id: 'goal-1', title: 'Viagem' }), goalRow({ id: 'goal-2', title: 'Casa', currentAmount: 0 })]);
        const ask = await service.handleMessage(msg('A', 'guardar 200'));
        expect(ask.kind).toBe('ASK_FIELD');
        expect(text(ask)).toContain('Qual meta? 1) Viagem 2) Casa.');
        expect(ask.draft?.pendingField).toBe('goal');

        const draft = await service.handleMessage(msg('A', '2'));
        expect(draft.kind).toBe('CONFIRM_DRAFT');
        expect(text(draft)).toContain('Meta: Casa (R$ 0,00 de R$ 3.000,00)');
        await service.handleMessage(msg('A', 'confirmar'));
        expect(goals.contribute).toHaveBeenCalledWith('A', 'goal-2', expect.anything());
      });

      it('"guardar viagem" com meta única pergunta o valor', async () => {
        setGoals([goalRow()]);
        const ask = await service.handleMessage(msg('A', 'guardar viagem'));
        expect(ask.kind).toBe('ASK_FIELD');
        expect(text(ask)).toContain(REPLIES.askContributionAmount);
        const draft = await service.handleMessage(msg('A', '200'));
        expect(draft.kind).toBe('CONFIRM_DRAFT');
        expect(draft.draft?.rows).toContainEqual({ label: 'Valor', value: 'R$ 200,00' });
      });

      it('opção removida não desloca o número para outra meta', async () => {
        setGoals([goalRow({ id: 'goal-1', title: 'Viagem' }), goalRow({ id: 'goal-2', title: 'Casa' })]);
        await service.handleMessage(msg('A', 'guardar 200'));
        setGoals([goalRow({ id: 'goal-2', title: 'Casa' })]);
        const first = await service.handleMessage(msg('A', '1'));
        expect(first.kind).toBe('ASK_FIELD');
        expect(first.text).toContain('1) indisponível 2) Casa');
        expect(goals.contribute).not.toHaveBeenCalled();
        const second = await service.handleMessage(msg('A', '2'));
        expect(second.kind).toBe('CONFIRM_DRAFT');
        await service.handleMessage(msg('A', 'confirmar'));
        expect(goals.contribute).toHaveBeenCalledWith('A', 'goal-2', expect.anything());
      });

      it('sem valor e com nome que não casa com meta ativa vai ao Selah, sem rascunho nem pedir valor', async () => {
        setGoals([goalRow()]);
        const reply = await service.handleMessage(msg('A', 'guardar dinheiro é importante'));
        expect(reply.kind).toBe('HELP');
        expect(reply.unrecognized).toBe(true);
        expect(db.sessions).toHaveLength(0);
        expect(db.events.at(-1)).toMatchObject({ intent: null, outcome: ConversationOutcome.UNRECOGNIZED });
      });

      it('sem valor, nome que não casa e conta sem metas também vai ao Selah', async () => {
        const reply = await service.handleMessage(msg('A', 'colocar o dinheiro no banco'));
        expect(reply.unrecognized).toBe(true);
        expect(db.sessions).toHaveLength(0);
      });

      it('com valor e meta inexistente continua recusando e listando as metas (não vai ao Selah)', async () => {
        setGoals([goalRow()]);
        const reply = await service.handleMessage(msg('A', 'guardar 50 dinheiro é importante'));
        expect(reply.kind).toBe('ERROR');
        expect(reply.unrecognized).toBeUndefined();
        expect(text(reply)).toContain('Metas ativas: Viagem.');
      });

      it('sem valor e sem nome ("guardar") com várias metas pergunta qual, não vai ao Selah', async () => {
        setGoals([goalRow(), goalRow({ id: 'goal-2', title: 'Casa' })]);
        const reply = await service.handleMessage(msg('A', 'guardar'));
        expect(reply.kind).toBe('ASK_FIELD');
        expect(reply.unrecognized).toBeUndefined();
      });

      it('"guardar viagem 200": valor depois do nome quando o nome inteiro não casa', async () => {
        setGoals([goalRow()]);
        const reply = await service.handleMessage(msg('A', 'guardar viagem 200'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(db.sessions[0].draft).toMatchObject({ goalId: 'goal-1', amountCents: 20_000 });
      });

      it('meta "Viagem 2027" tem prioridade sobre ler 2027 como valor', async () => {
        setGoals([goalRow({ title: 'Viagem 2027' })]);
        const reply = await service.handleMessage(msg('A', 'guardar viagem 2027'));
        expect(reply.kind).toBe('ASK_FIELD');
        expect(reply.draft?.pendingField).toBe('amount');
      });

      it('"guardar 200 reais na minha viagem" acha a meta', async () => {
        setGoals([goalRow()]);
        const reply = await service.handleMessage(msg('A', 'guardar 200 reais na minha viagem'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
      });

      it('aviso "conclui a meta" usa a mesma conta do serviço (0,7 + 0,1 não bate 0,8 em ponto flutuante)', async () => {
        setGoals([goalRow({ targetAmount: 0.8, currentAmount: 0.7 })]);
        const draft = await service.handleMessage(msg('A', 'guardar 0,10 na viagem'));
        expect(text(draft)).not.toContain('conclui a meta');
        await service.handleMessage(msg('A', 'cancelar'));
        setGoals([goalRow({ targetAmount: 0.3, currentAmount: 0.1 })]);
        const draft2 = await service.handleMessage(msg('A', 'guardar 0,20 na viagem'));
        expect(text(draft2)).toContain('conclui a meta');
      });

      it('valor zero recusa e mantém a pergunta de valor', async () => {
        setGoals([goalRow()]);
        const reply = await service.handleMessage(msg('A', 'guardar 0 viagem'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.amountZero);
        expect(db.sessions).toHaveLength(0);
      });

      it('sem meta ativa responde que não há meta e não abre rascunho', async () => {
        setGoals([goalRow({ status: 'PAUSED' })]);
        const reply = await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.noActiveGoals);
        expect(db.sessions).toHaveLength(0);
      });

      it('nome que não casa com meta ativa lista as metas ativas', async () => {
        setGoals([goalRow({ title: 'Viagem' })]);
        const reply = await service.handleMessage(msg('A', 'guardar 200 na férias'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe('Não achei uma meta ativa com esse nome. Metas ativas: Viagem.');
        expect(db.sessions).toHaveLength(0);
      });

      it('meta pausada com o mesmo nome não é escolhida: só as ativas contam', async () => {
        setGoals([goalRow({ id: 'goal-p', title: 'Viagem', status: 'PAUSED' }), goalRow({ id: 'goal-1', title: 'Viagem casa' })]);
        await service.handleMessage(msg('A', 'guardar 50 viagem'));
        await service.handleMessage(msg('A', 'confirmar'));
        expect(goals.contribute).toHaveBeenCalledWith('A', 'goal-1', expect.anything());
      });

      it('nome que só aparece no meio do título casa pela terceira regra ("contém")', async () => {
        setGoals([goalRow({ title: 'Viagem de férias' })]);
        const reply = await service.handleMessage(msg('A', 'guardar 10 férias'));
        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.draft?.rows[0]).toEqual({ label: 'Meta', value: 'Viagem de férias (R$ 1.200,00 de R$ 3.000,00)' });
      });

      it('aporte que atinge o alvo avisa no rascunho e responde "Meta concluída."', async () => {
        setGoals([goalRow({ currentAmount: 2900 })]);
        goals.contribute.mockResolvedValueOnce({ id: 'goal-1', title: 'Viagem', status: 'ACHIEVED', targetAmount: 3000, currentAmount: 3100 });
        const draft = await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        expect(text(draft)).toContain('Este aporte conclui a meta.');
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.text).toContain('Meta concluída.');
      });

      it('aporte que iguala o alvo exatamente já conclui a meta (>=, não >)', async () => {
        setGoals([goalRow({ currentAmount: 2900 })]);
        const draft = await service.handleMessage(msg('A', 'guardar 100 na viagem'));
        expect(text(draft)).toContain('Este aporte conclui a meta.');
        expect(draft.draft?.rows).toContainEqual({ label: 'Aviso', value: 'Este aporte conclui a meta.' });
        await service.handleMessage(msg('A', 'cancelar'));
        const below = await service.handleMessage(msg('A', 'guardar 99,99 na viagem'));
        expect(text(below)).not.toContain('conclui a meta');
      });

      it('evento da confirmação de aporte leva appliedKey sessao:versao e o id da meta', async () => {
        setGoals([goalRow()]);
        const draft = await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        await service.handleMessage(msg('A', 'confirmar'));
        const event = db.events.find((row) => row.outcome === ConversationOutcome.COMPLETED);
        expect(event).toMatchObject({ intent: 'contribute_goal', resultRef: 'goal-1' });
        expect(event?.appliedKey).toBe(`${draft.draft?.draftId}:${draft.draft?.draftVersion}`);
      });

      it('cofrinho sem alvo mostra o guardado, sem percentual', async () => {
        setGoals([goalRow({ targetAmount: null, currentAmount: 50 })]);
        const draft = await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        expect(text(draft)).toContain('Meta: Viagem (R$ 50,00 guardados)');
        expect(text(draft)).not.toContain('conclui a meta');
        goals.contribute.mockResolvedValueOnce({ id: 'goal-1', title: 'Viagem', status: 'ACTIVE', targetAmount: null, currentAmount: 250 });
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.text).toBe('Aporte feito: R$ 200,00 em Viagem. Agora R$ 250,00 guardados.');
      });

      it('meta apagada entre rascunho e confirmação descarta com a mensagem do contrato', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        goals.contribute.mockRejectedValueOnce(new NotFoundException('Meta nao encontrada.'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe('Não foi possível gravar. A meta pode ter sido removida.');
        expect(db.sessions).toHaveLength(0);
      });

      it('falha inesperada em GoalsService.contribute restaura o rascunho', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        goals.contribute.mockRejectedValueOnce(new Error('banco caiu'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(text(reply)).toBe(REPLIES.contributionSaveFailed);
        expect(db.sessions).toHaveLength(1);
      });

      it('duas confirmações em paralelo chamam GoalsService.contribute uma vez', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        const [first, second] = await Promise.all([
          service.handleMessage(msg('A', 'confirmar')),
          service.handleMessage(msg('A', 'confirmar')),
        ]);
        expect([first.kind, second.kind].filter((kind) => kind === 'DONE')).toHaveLength(1);
        expect(goals.contribute).toHaveBeenCalledTimes(1);
      });

      it('rascunho de aporte expira em 5 minutos na confirmação', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        const reply = await service.handleMessage(msg('A', 'confirmar', new Date(T0.getTime() + 5 * 60_000 + 1000)));
        expect(reply.kind).toBe('EXPIRED');
        expect(goals.contribute).not.toHaveBeenCalled();
      });
    });

    describe('isolamento entre contas A e B (metas)', () => {
      it('B não confirma nem responde pela meta de A; nada de A muda', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        const reply = await service.handleMessage(msg('B', 'confirmar'));
        expect(reply.kind).toBe('HELP');
        expect(goals.contribute).not.toHaveBeenCalled();
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0].userId).toBe('A');
      });

      it('B não grava meta com o rascunho de A', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        await service.handleMessage(msg('B', 'confirmar'));
        expect(goals.create).not.toHaveBeenCalled();
      });

      it('aporte de A nunca usa meta de B, mesmo que o serviço devolva a meta de B na lista', async () => {
        setGoals([goalRow({ id: 'goal-b', userId: 'B', title: 'Viagem' })]);
        const reply = await service.handleMessage(msg('A', 'guardar 100 viagem'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.noActiveGoals);
        expect(goals.contribute).not.toHaveBeenCalled();
        expect(goals.list).toHaveBeenCalledWith('A');
      });

      it('o userId repassado a create e a contribute é o da conta que confirma', async () => {
        setGoals([goalRow()]);
        await service.handleMessage(msg('A', 'guardar 200 na viagem'));
        await service.handleMessage(msg('A', 'confirmar'));
        await service.handleMessage(msg('B', 'criar meta casa 500'));
        await service.handleMessage(msg('B', 'confirmar'));
        expect(goals.contribute.mock.calls.every((call) => call[0] === 'A')).toBe(true);
        expect(goals.create).toHaveBeenCalledWith('B', expect.objectContaining({ title: 'casa' }));
      });
    });

    describe('sessao antiga sem kind', () => {
      it('rascunho de lançamento sem campo kind continua como lançamento', async () => {
        db.sessions.push({
          id: 'old-1',
          userId: 'A',
          channel: ConversationChannel.APP,
          state: ConversationState.AWAITING_CONFIRMATION,
          intent: 'create_expense',
          draft: {
            type: 'EXPENSE',
            amountCents: 5000,
            description: 'mercado',
            categoryId: 'cat-mercado',
            date: '2026-11-15',
            paymentMethod: null,
            pendingField: null,
            categoryOptions: [],
          },
          version: 1,
          expiresAt: new Date(T0.getTime() + 5 * 60_000),
        });
        const view = await service.getSession('A');
        expect(view.draft).toMatchObject({ kind: 'TRANSACTION', title: 'Lançamento' });
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('DONE');
        expect(transactions.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('erro 4xx ao gravar (regra D5, vale para os tres tipos)', () => {
      it('lancamento recusado com 400 descarta o rascunho em vez de devolve-lo', async () => {
        await draftFor('A', '50 mercado');
        transactions.create.mockRejectedValueOnce(new BadRequestException('Categoria invalida.'));
        const reply = await service.handleMessage(msg('A', 'confirmar'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.transactionRejected);
        expect(db.sessions).toHaveLength(0);
      });
    });

    describe('reservas (envelopes)', () => {
      const envelope = (o: Row = {}): Row => ({
        name: 'Gasolina',
        isActive: true,
        monthlyAmount: 400,
        available: 150.5,
        spent: 249.5,
        ...o,
      });

      it('sem reservas ativas responde que não há', async () => {
        const reply = await service.handleMessage(msg('A', 'reservas'));
        expect(reply.kind).toBe('INFO');
        expect(text(reply)).toBe('Você ainda não tem reservas.');
      });

      it('lista ativas com mensal, disponível e gasto, e o total disponível com sinal', async () => {
        envelopes.list = jest.fn(async () => [
          envelope(),
          envelope({ name: 'Academia', monthlyAmount: 100, available: -20, spent: 120 }),
        ]);
        const reply = await service.handleMessage(msg('A', 'minhas reservas'));
        expect(text(reply)).toBe(
          [
            'Reservas ativas (2):',
            '• Gasolina: mensal R$ 400,00, disponível R$ 150,50, gasto R$ 249,50',
            '• Academia: mensal R$ 100,00, disponível -R$ 20,00, gasto R$ 120,00',
            'Disponível total: R$ 130,50.',
          ].join('\n'),
        );
        expect(reply.data).toMatchObject({
          envelopes: [
            { label: 'Gasolina', monthlyCents: 40_000, availableCents: 15_050, spentCents: 24_950 },
            { label: 'Academia', monthlyCents: 10_000, availableCents: -2000, spentCents: 12_000 },
          ],
          totalCents: 13_050,
        });
        expect(envelopes.list).toHaveBeenCalledWith('A', T0);
      });

      it('mais de 5 ativas: mostra 5 e diz quantas ficaram de fora', async () => {
        envelopes.list = jest.fn(async () =>
          Array.from({ length: 7 }, (_, index) => envelope({ name: `R${index}`, available: 10 })),
        );
        const reply = await service.handleMessage(msg('A', 'reservas'));
        expect(text(reply).split('\n').filter((line) => line.startsWith('• '))).toHaveLength(5);
        expect(text(reply)).toContain('e mais 2.');
        expect(reply.data?.envelopes).toHaveLength(5);
        expect(reply.data?.totalCents).toBe(7000);
      });

      it('reservas pausadas viram aviso e não entram na lista', async () => {
        envelopes.list = jest.fn(async () => [envelope({ isActive: false, name: 'Viagem' })]);
        const reply = await service.handleMessage(msg('A', 'reservas'));
        expect(text(reply)).toBe('Você ainda não tem reservas.\nVocê tem 1 reserva(s) pausada(s).');
      });

      it('"envelopes" e "reservas" são reservas; "metas" continua meta', async () => {
        envelopes.list = jest.fn(async () => []);
        expect(text(await service.handleMessage(msg('A', 'envelopes')))).toBe('Você ainda não tem reservas.');
        setGoals([goalRow({ title: 'Cofrinho X', targetAmount: null, currentAmount: 10 })]);
        expect(text(await service.handleMessage(msg('A', 'metas')))).toContain('• Cofrinho X');
        expect(goals.list).toHaveBeenCalledWith('A');
      });

      it('reservas de A nunca aparecem para B', async () => {
        envelopes.list = jest.fn(async (userId: string) => (userId === 'A' ? [envelope()] : []));
        const reply = await service.handleMessage(msg('B', 'reservas'));
        expect(text(reply)).toBe('Você ainda não tem reservas.');
        expect(envelopes.list).toHaveBeenCalledWith('B', T0);
      });

      it('falha do serviço de reservas vira ERROR genérico', async () => {
        envelopes.list = jest.fn(async () => {
          throw new Error('banco caiu');
        });
        const reply = await service.handleMessage(msg('A', 'reservas'));
        expect(reply.kind).toBe('ERROR');
        expect(text(reply)).toBe(REPLIES.consultError);
      });

      it('leitura de reservas durante rascunho de meta mantém o rascunho', async () => {
        await service.handleMessage(msg('A', 'criar meta viagem 3 mil'));
        const before = db.sessions[0].version;
        const reply = await service.handleMessage(msg('A', 'reservas'));
        expect(reply.kind).toBe('INFO');
        expect(db.sessions[0].version).toBe(before);
      });
    });
  });

  describe('reserva e limite do cartão (3b2a)', () => {
    const ENV_RECEIPT = { id: 'env-9', name: 'gasolina', monthlyCents: 40000, provisionMonth: '2026-11-01', refreshPending: false };
    const LIMIT_RECEIPT = { id: 'ceil-1', ceilingCents: 500000, cycleStart: '2026-11-06', cycleEnd: '2026-12-05', refreshPending: false };
    const CYCLE = {
      ceiling: 2000, spent: 500, remaining: 1500, percentUsed: 25, status: 'ok', closingDay: 5, dueDay: 12,
      countAllPayments: false,
      cycleStart: '2026-11-06T00:00:00.000Z',
      cycleEnd: '2026-12-05T00:00:00.000Z',
    };

    let envelopeWrite: jest.Mock;
    let limitWrite: jest.Mock;

    beforeEach(() => {
      envelopeWrite = jest.fn(async (_userId: string, dto: { name: string; monthlyAmount: number }, month: string) => ({
        ...ENV_RECEIPT,
        name: dto.name,
        monthlyCents: Math.round(dto.monthlyAmount * 100),
        provisionMonth: month,
      }));
      limitWrite = jest.fn(async (_userId: string, dto: { ceiling: number }, expected: { cycleStart: string; cycleEnd: string }) => ({
        ...LIMIT_RECEIPT,
        ceilingCents: Math.round(dto.ceiling * 100),
        cycleStart: expected.cycleStart,
        cycleEnd: expected.cycleEnd,
      }));
      envelopes.createForConversation = envelopeWrite;
      (creditCycle as Record<string, unknown>).setCeilingForConversation = limitWrite;
      creditCycle.getCurrent = jest.fn(async () => CYCLE);
    });

    const send = (userId: string, text: string, at: Date = T0) => service.handleMessage(msg(userId, text, at));
    const confirm = (userId: string, draftId: string, version: number) => service.confirmDraft(userId, draftId, version);
    const rowValue = (reply: { draft?: { rows: Array<{ label: string; value: string }> } }, label: string) =>
      reply.draft?.rows.filter((row) => row.label === label).map((row) => row.value);
    const envelopeEvents = () => db.events.filter((row) => row.intent === 'create_envelope');
    const withinMinutes = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

    /** Rascunho de reserva completo para A, pronto para confirmar. */
    async function envelopeDraft(text = 'criar reserva 400 gasolina') {
      const reply = await send('A', text);
      expect(reply.kind).toBe('CONFIRM_DRAFT');
      return reply.draft!;
    }

    /** Rascunho de limite completo para A. */
    async function limitDraft(text = 'definir limite do cartão 5000') {
      const reply = await send('A', text);
      expect(reply.kind).toBe('CONFIRM_DRAFT');
      return reply.draft!;
    }

    describe('abertura e coleta', () => {
      it('"criar reserva 400 gasolina" vira confirmação com as linhas da tela, sem gravar', async () => {
        const reply = await send('A', 'criar reserva 400 gasolina');

        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.state).toBe(ConversationState.AWAITING_CONFIRMATION);
        expect(reply.draft).toMatchObject({ kind: 'ENVELOPE', title: 'Reserva', pendingField: null });
        expect(rowValue(reply, 'Nome')).toEqual(['gasolina']);
        expect(rowValue(reply, 'Valor mensal')).toEqual([formatBrl(40000)]);
        expect(rowValue(reply, 'Início')).toEqual(['11/2026 (UTC)']);
        expect(envelopeWrite).not.toHaveBeenCalled();
      });

      it('só o nome pergunta o valor; só o valor pergunta o nome; vazio pergunta o nome primeiro', async () => {
        const onlyName = await send('A', 'criar reserva gasolina');
        expect(onlyName).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askEnvelopeAmount });

        const onlyValue = await send('B', 'criar reserva 400');
        expect(onlyValue).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askEnvelopeName });

        const empty = await send('C', 'nova reserva');
        expect(empty).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askEnvelopeName });
      });

      it('nome que começa com número é nome durante a coleta, e depois pede o valor', async () => {
        await send('A', 'criar reserva');

        const reply = await send('A', '2026 viagem');

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askEnvelopeAmount });
        expect(db.sessions[0].draft).toMatchObject({ name: '2026 viagem', pendingField: 'amount' });
      });

      it('resposta ao valor precisa ser só o valor: texto extra pede reenvio e mantém o campo', async () => {
        await send('A', 'criar reserva gasolina');

        const reply = await send('A', '400 extra');

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: `${REPLIES.amountOnly}\n${REPLIES.askEnvelopeAmount}` });
        expect(db.sessions[0].draft).toMatchObject({ monthlyCents: null, pendingField: 'amount' });
      });

      it.each([
        ['criar reserva 0 gasolina', REPLIES.amountZero],
        ['criar reserva -5 gasolina', REPLIES.amountNegative],
        ['criar reserva 1,234 gasolina', REPLIES.amountAmbiguous],
      ])('valor inválido não abre rascunho: "%s"', async (text, message) => {
        const reply = await send('A', text);

        expect(reply).toMatchObject({ kind: 'ERROR', text: message });
        expect(db.sessions).toHaveLength(0);
      });

      it('nome de 1 caractere não conta: volta a perguntar; 61 recusa; 60 aceita', async () => {
        const short = await send('A', 'criar reserva 400 a');
        expect(short).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askEnvelopeName });
        db.sessions.length = 0;

        const tooLong = await send('A', `criar reserva 400 ${'x'.repeat(61)}`);
        expect(tooLong).toMatchObject({ kind: 'ERROR', text: REPLIES.envelopeNameTooLong });

        const max = await send('A', `criar reserva 400 ${'x'.repeat(60)}`);
        expect(max.kind).toBe('CONFIRM_DRAFT');
      });

      it('plano sem vaga: recusa ao abrir, sem rascunho', async () => {
        entitlements.assertCanCreate.mockRejectedValueOnce(
          new PlanLimitException({ resource: 'envelopes', limit: 1, used: 1, plan: 'FREE' }),
        );

        const reply = await send('A', 'criar reserva 400 gasolina');

        expect(reply.kind).toBe('ERROR');
        expect(reply.text).toMatch(/reservas/);
        expect(db.sessions).toHaveLength(0);
      });

      it('nome já usado pelo mesmo dono: recusa ao abrir, consultando o nome exato', async () => {
        db.prisma.envelope.findFirst.mockResolvedValueOnce({ id: 'env-old' });

        const reply = await send('A', 'criar reserva 400 gasolina');

        expect(reply).toMatchObject({ kind: 'ERROR', text: REPLIES.envelopeNameTaken });
        expect(db.prisma.envelope.findFirst).toHaveBeenCalledWith({ where: { userId: 'A', name: 'gasolina' }, select: { id: true } });
        expect(db.sessions).toHaveLength(0);
      });

      it('coleta dura 15 minutos: depois disso a resposta chega como rascunho expirado', async () => {
        await send('A', 'criar reserva');

        const reply = await send('A', 'gasolina', new Date(withinMinutes(15).getTime() + 1));

        expect(reply.kind).toBe('EXPIRED');
      });

      it('leitura durante a coleta responde e não altera o rascunho', async () => {
        await send('A', 'criar reserva gasolina');
        const before = structuredClone(db.sessions[0]);

        const reply = await send('A', 'saldo');

        expect(reply.kind).toBe('INFO');
        expect(db.sessions[0]).toEqual(before);
      });
    });

    describe('confirmação de reserva', () => {
      it('confirmar grava com o recibo: DONE com envelopeId, texto e resultRef', async () => {
        const draft = await envelopeDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({
          kind: 'DONE',
          state: 'IDLE',
          text: `Reserva criada: gasolina, ${formatBrl(40000)} por mês.`,
          data: { envelopeId: 'env-9' },
        });
        expect(envelopeWrite).toHaveBeenCalledWith('A', { name: 'gasolina', color: '#f18f01', monthlyAmount: 400 }, '2026-11-01');
        expect(envelopeEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.COMPLETED, resultRef: 'env-9' });
      });

      it('confirmação com refreshPending acrescenta o aviso, sem virar erro', async () => {
        envelopeWrite.mockResolvedValueOnce({ ...ENV_RECEIPT, refreshPending: true });
        const draft = await envelopeDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('DONE');
        expect(reply.text).toBe(`Reserva criada: gasolina, ${formatBrl(40000)} por mês.\n${REPLIES.refreshPending}`);
      });

      it('falha inesperada antes da gravação restaura o rascunho (D5)', async () => {
        envelopeWrite.mockRejectedValueOnce(new Error('falha de banco'));
        const draft = await envelopeDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: ConversationState.AWAITING_CONFIRMATION, text: REPLIES.envelopeSaveFailed });
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0]).toMatchObject({ version: 1, state: ConversationState.AWAITING_CONFIRMATION });
        expect(envelopeEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.ERROR, appliedKey: null });
      });

      it('erro 4xx do serviço descarta o rascunho com orientação segura', async () => {
        envelopeWrite.mockRejectedValueOnce(new BadRequestException('detalhe interno do domínio'));
        const draft = await envelopeDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        // Mensagem do domínio nunca vaza: só o texto seguro do motor.
        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.envelopeRejected });
        expect(reply.text).not.toContain('domínio');
        expect(db.sessions).toHaveLength(0);
      });

      it('resultado de commit desconhecido: sem restaurar, sem liberar a chave e sem DONE', async () => {
        envelopeWrite.mockRejectedValueOnce(new EnvelopeWriteUncertainError());
        const draft = await envelopeDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.writeUncertain });
        expect(db.sessions).toHaveLength(0);
        expect(envelopeEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.ERROR, appliedKey: `${draft.draftId}:1` });
      });

      it('nome repetido por corrida com a tela: descarta com a mensagem conhecida de duplicidade', async () => {
        const draft = await envelopeDraft();
        envelopeWrite.mockRejectedValueOnce(new BadRequestException(REPLIES.envelopeNameTaken));

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.envelopeNameTaken });
        expect(db.sessions).toHaveLength(0);
      });

      it('plano esgotado entre abrir e confirmar: descarta com a mensagem do plano', async () => {
        const draft = await envelopeDraft();
        entitlements.assertCanCreate.mockRejectedValueOnce(
          new PlanLimitException({ resource: 'envelopes', limit: 1, used: 1, plan: 'FREE' }),
        );
        envelopeWrite.mockImplementationOnce(async () => {
          throw new PlanLimitException({ resource: 'envelopes', limit: 1, used: 1, plan: 'FREE' });
        });

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('ERROR');
        expect(reply.text).toMatch(/reservas/);
        expect(db.sessions).toHaveLength(0);
      });

      it('mês da provisão mudou: nenhuma gravação, nova versão, prazo de 5 minutos e nova confirmação', async () => {
        const draft = await envelopeDraft();
        envelopeWrite.mockRejectedValueOnce(new EnvelopeMonthChangedError('2026-12-01'));

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.text.startsWith(REPLIES.envelopeMonthChanged)).toBe(true);
        expect(reply.draft).toMatchObject({ draftVersion: 2 });
        expect(rowValue(reply, 'Início')).toEqual(['12/2026 (UTC)']);
        expect(rowValue(reply, 'Atenção')).toEqual([REPLIES.envelopeMonthChanged]);
        expect(db.sessions[0]).toMatchObject({ version: 2, expiresAt: withinMinutes(5) });
        expect(envelopeEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.ERROR, appliedKey: null });
      });

      it('GET /session depois da revisão da reserva mostra o mesmo cartão: mês novo, versão 2 e linha "Atenção"', async () => {
        const draft = await envelopeDraft();
        envelopeWrite.mockRejectedValueOnce(new EnvelopeMonthChangedError('2026-12-01'));
        const revised = await confirm('A', draft.draftId, draft.draftVersion);

        const session = await service.getSession('A');

        expect(session.state).toBe(ConversationState.AWAITING_CONFIRMATION);
        expect(session.draft).toMatchObject({ kind: 'ENVELOPE', draftId: draft.draftId, draftVersion: 2 });
        expect(session.draft?.rows).toEqual(revised.draft?.rows);
        expect(session.draft?.rows).toContainEqual({ label: 'Atenção', value: REPLIES.envelopeMonthChanged });
        expect(session.draft?.rows).toContainEqual({ label: 'Início', value: '12/2026 (UTC)' });
        // Sem revisão, não existe a linha.
        const plain = await service.getSession('B');
        expect(plain).toEqual({ state: 'IDLE' });
      });

      it('GET /session do rascunho sem revisão não tem linha "Atenção"', async () => {
        await envelopeDraft();

        const session = await service.getSession('A');

        expect(session.draft?.rows.some((row) => row.label === 'Atenção')).toBe(false);
      });

      it('depois da revisão, a versão antiga não confirma e a nova grava no mês mostrado', async () => {
        const draft = await envelopeDraft();
        envelopeWrite.mockRejectedValueOnce(new EnvelopeMonthChangedError('2026-12-01'));
        await confirm('A', draft.draftId, draft.draftVersion);

        expect(await confirm('A', draft.draftId, 1)).toBeNull();
        const reply = await confirm('A', draft.draftId, 2);

        expect(reply.kind).toBe('DONE');
        expect(envelopeWrite).toHaveBeenLastCalledWith('A', expect.anything(), '2026-12-01');
      });

      it('duas confirmações em paralelo criam uma só reserva', async () => {
        const draft = await envelopeDraft();

        const [first, second] = await Promise.all([
          confirm('A', draft.draftId, draft.draftVersion),
          confirm('A', draft.draftId, draft.draftVersion),
        ]);

        expect([first?.kind, second?.kind].sort()).toEqual(['DONE', 'DUPLICATE']);
        expect(envelopeWrite).toHaveBeenCalledTimes(1);
      });

      it('revisão sem espaço: se outro rascunho foi aberto, não sobrescreve e pede novo pedido', async () => {
        const draft = await envelopeDraft();
        envelopeWrite.mockImplementationOnce(async () => {
          db.sessions.push({
            id: 'outro', userId: 'A', channel: ConversationChannel.APP, state: ConversationState.COLLECTING_FIELDS,
            intent: 'create_expense', draft: {}, version: 1, expiresAt: T0,
          });
          throw new EnvelopeMonthChangedError('2026-12-01');
        });

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', text: REPLIES.revisionRestoreLost });
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0].id).toBe('outro');
      });
    });

    describe('confirmação de limite do cartão', () => {
      it('mostra ciclo, limite atual e novo; aviso de validade do ciclo', async () => {
        const reply = await send('A', 'definir limite do cartão 5 mil');

        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.draft).toMatchObject({ kind: 'CREDIT_LIMIT', title: 'Limite do cartão' });
        expect(rowValue(reply, 'Ciclo')).toEqual(['06/11/2026 a 05/12/2026']);
        expect(rowValue(reply, 'Limite atual')).toEqual([formatBrl(200000)]);
        expect(rowValue(reply, 'Novo limite')).toEqual([formatBrl(500000)]);
        expect(rowValue(reply, 'Aviso')).toEqual([REPLIES.creditLimitCycleWarning]);
        expect(limitWrite).not.toHaveBeenCalled();
      });

      it('com a opção de todas as formas ligada, acrescenta o segundo aviso', async () => {
        creditCycle.getCurrent = jest.fn(async () => ({ ...CYCLE, countAllPayments: true }));

        const reply = await send('A', 'definir limite 5000');

        expect(rowValue(reply, 'Aviso')).toEqual([REPLIES.creditLimitCycleWarning, REPLIES.creditLimitAllPaymentsWarning]);
      });

      it('sem teto anterior mostra "não definido"', async () => {
        creditCycle.getCurrent = jest.fn(async () => ({ ...CYCLE, ceiling: null }));

        const reply = await send('A', 'definir limite 5000');

        expect(rowValue(reply, 'Limite atual')).toEqual(['não definido']);
      });

      it('leitura do ciclo falha ao abrir: ERROR genérico, evento ERROR, sem rascunho e log só com intenção e nome do erro', async () => {
        creditCycle.getCurrent = jest.fn(async () => {
          throw Object.assign(new Error('senha=segredo valor 5000 definir limite'), { name: 'PrismaClientKnownRequestError' });
        });

        const reply = await send('A', 'definir limite 5000');

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.consultError });
        expect(reply.draft).toBeUndefined();
        expect(db.sessions).toHaveLength(0);
        expect(limitWrite).not.toHaveBeenCalled();
        expect(db.events).toHaveLength(1);
        expect(db.events[0]).toMatchObject({ userId: 'A', intent: 'set_credit_limit', outcome: ConversationOutcome.ERROR });
        expect(warn).toHaveBeenCalledWith('Leitura falhou: intent=set_credit_limit erro=PrismaClientKnownRequestError');
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).not.toContain('segredo');
        expect(logged).not.toContain('5000');
        // Ids são UUIDs aleatórios: fora da checagem de conteúdo.
        expect(JSON.stringify(db.events, (key, value) => (['id', 'messageId', 'appliedKey'].includes(key) ? undefined : value))).not.toContain('5000');
      });

      it('leitura do ciclo falha com corpo vazio: também ERROR genérico, sem 500', async () => {
        creditCycle.getCurrent = jest.fn(async () => {
          throw new Error('x');
        });

        const reply = await send('A', 'definir limite');

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.consultError });
        expect(db.sessions).toHaveLength(0);
      });

      it('confirmar grava com o ciclo do rascunho e devolve DONE com resultRef do teto', async () => {
        const draft = await limitDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(limitWrite).toHaveBeenCalledWith(
          'A',
          { ceiling: 5000 },
          { cycleStart: '2026-11-06', cycleEnd: '2026-12-05', previousCeilingCents: 200000, countAllPayments: false },
        );
        expect(reply).toMatchObject({
          kind: 'DONE',
          text: `Limite de ${formatBrl(500000)} definido para o ciclo com fechamento em 05/12/2026.`,
          data: {},
        });
        expect(db.events.filter((row) => row.intent === 'set_credit_limit').at(-1)).toMatchObject({ resultRef: 'ceil-1' });
      });

      it('confirmação com refreshPending acrescenta o aviso, sem virar erro nem restaurar', async () => {
        const draft = await limitDraft();
        limitWrite.mockResolvedValueOnce({ ...LIMIT_RECEIPT, refreshPending: true });

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('DONE');
        expect(reply.text).toBe(
          `Limite de ${formatBrl(500000)} definido para o ciclo com fechamento em 05/12/2026.\n${REPLIES.refreshPending}`,
        );
        expect(db.sessions).toHaveLength(0);
        expect(db.events.filter((row) => row.intent === 'set_credit_limit').at(-1)).toMatchObject({
          outcome: ConversationOutcome.COMPLETED,
          resultRef: 'ceil-1',
        });
      });

      it('ciclo mudou antes da confirmação: nenhuma gravação no novo ciclo, nova confirmação com o ciclo atual', async () => {
        const draft = await limitDraft();
        limitWrite.mockRejectedValueOnce(
          new CreditLimitChangedError({
            cycleStart: '2026-12-06', cycleEnd: '2027-01-05', previousCeilingCents: null, countAllPayments: false,
          }),
        );

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.text.startsWith(REPLIES.creditLimitChanged)).toBe(true);
        expect(rowValue(reply, 'Ciclo')).toEqual(['06/12/2026 a 05/01/2027']);
        expect(rowValue(reply, 'Novo limite')).toEqual([formatBrl(500000)]);
        expect(limitWrite).toHaveBeenCalledTimes(1);

        const done = await confirm('A', draft.draftId, 2);
        expect(done.kind).toBe('DONE');
        expect(limitWrite).toHaveBeenLastCalledWith(
          'A',
          { ceiling: 5000 },
          { cycleStart: '2026-12-06', cycleEnd: '2027-01-05', previousCeilingCents: null, countAllPayments: false },
        );
      });

      it('GET /session depois da revisão do limite mostra ciclo novo, versão 2 e a linha "Atenção"', async () => {
        const draft = await limitDraft();
        limitWrite.mockRejectedValueOnce(
          new CreditLimitChangedError({
            cycleStart: '2026-12-06', cycleEnd: '2027-01-05', previousCeilingCents: null, countAllPayments: true,
          }),
        );
        const revised = await confirm('A', draft.draftId, draft.draftVersion);

        const session = await service.getSession('A');

        expect(session.state).toBe(ConversationState.AWAITING_CONFIRMATION);
        expect(session.draft).toMatchObject({ kind: 'CREDIT_LIMIT', draftId: draft.draftId, draftVersion: 2 });
        expect(session.draft?.rows).toEqual(revised.draft?.rows);
        expect(session.draft?.rows).toContainEqual({ label: 'Atenção', value: REPLIES.creditLimitChanged });
        expect(session.draft?.rows).toContainEqual({ label: 'Ciclo', value: '06/12/2026 a 05/01/2027' });
        expect(session.draft?.rows).toContainEqual({ label: 'Aviso', value: REPLIES.creditLimitAllPaymentsWarning });
      });

      it('falha inesperada restaura o rascunho; 4xx descarta; commit desconhecido não restaura', async () => {
        const restore = await limitDraft();
        limitWrite.mockRejectedValueOnce(new Error('falha'));
        expect(await confirm('A', restore.draftId, restore.draftVersion)).toMatchObject({
          kind: 'ERROR', text: REPLIES.creditLimitSaveFailed, state: ConversationState.AWAITING_CONFIRMATION,
        });
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0]).toMatchObject({ version: 1 });

        // Restaurado na mesma versão: pode tentar de novo; agora o plano recusa (4xx) e descarta.
        limitWrite.mockRejectedValueOnce(new BadRequestException('x'));
        expect(await confirm('A', restore.draftId, 1)).toMatchObject({ kind: 'ERROR', text: REPLIES.creditLimitRejected });
        expect(db.sessions).toHaveLength(0);

        const uncertain = await limitDraft();
        limitWrite.mockRejectedValueOnce(new CreditLimitWriteUncertainError());
        expect(await confirm('A', uncertain.draftId, uncertain.draftVersion)).toMatchObject({
          kind: 'ERROR', text: REPLIES.writeUncertain,
        });
        expect(db.sessions).toHaveLength(0);
      });
    });

    describe('valor do limite', () => {
      it('corpo vazio pergunta o valor', async () => {
        const reply = await send('A', 'definir limite do cartão');

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askCreditLimit });
        expect(db.sessions[0].draft).toMatchObject({ ceilingCents: null, pendingField: 'amount' });
      });

      it('"definir limite 5000 Nubank" pede reenvio, sem ignorar o banco', async () => {
        const reply = await send('A', 'definir limite 5000 Nubank');

        expect(reply).toMatchObject({ kind: 'ERROR', text: REPLIES.creditLimitValueOnly });
        expect(db.sessions).toHaveLength(0);
      });

      it.each([
        ['definir limite 0', REPLIES.amountZero],
        ['definir limite 1,234', REPLIES.amountAmbiguous],
        ['definir limite -100', REPLIES.amountNegative],
        ['definir limite 1000001', REPLIES.amountTooLarge],
      ])('valor que não é limite não abre confirmação: "%s"', async (text, message) => {
        expect(await send('A', text)).toMatchObject({ kind: 'ERROR', text: message });
        expect(db.sessions).toHaveLength(0);
      });

      it('resposta ao pedido de valor precisa ser só o valor', async () => {
        await send('A', 'definir limite do cartão');

        expect(await send('A', '5000 Nubank')).toMatchObject({
          kind: 'ASK_FIELD',
          text: `${REPLIES.amountOnly}\n${REPLIES.askCreditLimit}`,
        });
        expect(await send('A', '5000')).toMatchObject({ kind: 'CONFIRM_DRAFT' });
      });

      it('"cartão" e "limite do cartão" continuam leituras, sem rascunho', async () => {
        const reply = await send('A', 'limite do cartão');

        expect(reply.kind).toBe('INFO');
        expect(db.sessions).toHaveLength(0);
      });
    });

    describe('isolamento entre donos', () => {
      it('B não confirma, cancela nem reaproveita o rascunho de A', async () => {
        const draft = await envelopeDraft();

        expect(await confirm('B', draft.draftId, draft.draftVersion)).toBeNull();
        expect(await service.cancelDraft('B', draft.draftId)).toBeNull();
        const bText = await send('B', 'confirmar');

        expect(bText.kind).toBe('HELP');
        expect(envelopeWrite).not.toHaveBeenCalled();
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0].userId).toBe('A');
      });

      it('reserva e teto são sempre do dono autenticado', async () => {
        const draft = await limitDraft();

        await confirm('A', draft.draftId, draft.draftVersion);

        expect(limitWrite.mock.calls[0][0]).toBe('A');
      });
    });
  });

  describe('conta fixa e compra parcelada (3b2b)', () => {
    const send = (userId: string, text: string, at: Date = T0) => service.handleMessage(msg(userId, text, at));
    const confirm = (userId: string, draftId: string, version: number) => service.confirmDraft(userId, draftId, version);
    // Aceita a resposta do motor ou só o rascunho (DraftView): ambos têm `rows`.
    const rowValue = (source: { draft?: { rows: Array<{ label: string; value: string }> }; rows?: Array<{ label: string; value: string }> }, label: string) =>
      (source.draft ?? source).rows?.filter((row) => row.label === label).map((row) => row.value);
    const recurringEvents = () => db.events.filter((row) => row.intent === 'create_recurring');
    const installmentEvents = () => db.events.filter((row) => row.intent === 'create_installment');
    const withinMinutes = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

    async function recurringDraft(text = 'criar conta fixa 120 internet mensal primeiro 20/11/2026') {
      const reply = await send('A', text);
      expect(reply.kind).toBe('CONFIRM_DRAFT');
      return reply.draft!;
    }

    async function installmentDraft(text = 'criar parcelado 1200 geladeira em 12x primeiro 20/11/2026') {
      const reply = await send('A', text);
      expect(reply.kind).toBe('CONFIRM_DRAFT');
      return reply.draft!;
    }

    describe('abertura e rascunho da conta fixa', () => {
      it('comando completo vira confirmação com as linhas da tela, sem gravar', async () => {
        const reply = await send('A', 'criar conta fixa 120 internet mensal primeiro 20/11/2026');

        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.state).toBe(ConversationState.AWAITING_CONFIRMATION);
        expect(reply.draft).toMatchObject({ kind: 'RECURRING', title: 'Conta fixa', pendingField: null, type: 'EXPENSE', amount: null });
        expect(rowValue(reply, 'Descrição')).toEqual(['internet']);
        expect(rowValue(reply, 'Valor por vencimento')).toEqual([formatBrl(12000)]);
        expect(rowValue(reply, 'Frequência')).toEqual(['Mensal']);
        expect(rowValue(reply, 'Primeiro vencimento')).toEqual(['20/11/2026']);
        expect(rowValue(reply, 'Categoria')).toEqual(['não informada']);
        expect(rowValue(reply, 'Forma de pagamento')).toEqual(['não informada']);
        expect(rowValue(reply, 'Aviso')).toEqual([REPLIES.futureDueWarning, REPLIES.catchUpWarning]);
        expect(reply.text).toBe(`Conta fixa internet: ${formatBrl(12000)} por vencimento, mensal, primeiro vencimento em 20/11/2026.`);
        expect(recurring.createForConversation).not.toHaveBeenCalled();
      });

      it('sem frequência vira mensal e aparece no cartão; "semanal" e "anual" são aceitos', async () => {
        const padrao = await recurringDraft('criar conta fixa 120 internet primeiro 20/11/2026');
        expect(rowValue(padrao, 'Frequência')).toEqual(['Mensal']);

        db.sessions.length = 0;
        const semanal = await recurringDraft('criar conta fixa 120 internet semanal primeiro 20/11/2026');
        expect(rowValue(semanal, 'Frequência')).toEqual(['Semanal']);

        db.sessions.length = 0;
        const anual = await recurringDraft('criar conta fixa 120 internet anual primeiro 20/11/2026');
        expect(rowValue(anual, 'Frequência')).toEqual(['Anual']);
      });

      it('palavra de frequência no meio da descrição não é removida', async () => {
        const draft = await recurringDraft('criar conta fixa 120 mensal de teste primeiro 20/11/2026');

        expect(rowValue(draft, 'Descrição')).toEqual(['mensal de teste']);
        expect(rowValue(draft, 'Frequência')).toEqual(['Mensal']);
      });

      it('ordem de coleta: descrição, valor e vencimento, cada um perguntado quando falta', async () => {
        const vazio = await send('A', 'criar conta fixa');
        expect(vazio).toMatchObject({ kind: 'ASK_FIELD', state: ConversationState.COLLECTING_FIELDS });
        expect(vazio.draft).toMatchObject({ pendingField: 'description' });
        expect(vazio.text).toBe(REPLIES.askDraftDescription);

        // Texto que começa com número é a descrição pedida, não um valor de lançamento.
        const comNumero = await send('A', '2026 viagem');
        expect(comNumero.draft).toMatchObject({ pendingField: 'amount' });
        expect(rowValue(comNumero, 'Descrição')).toEqual(['2026 viagem']);

        const valor = await send('A', '120');
        expect(valor).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askFirstDue });
        expect(valor.draft).toMatchObject({ pendingField: 'firstDueDate' });

        const pronto = await send('A', 'hoje');
        expect(pronto.kind).toBe('CONFIRM_DRAFT');
        expect(rowValue(pronto, 'Primeiro vencimento')).toEqual(['15/11/2026']);
        expect(rowValue(pronto, 'Aviso')?.[0]).toBe(REPLIES.recurringTodayWarning);
      });

      it('resposta de vencimento que começa com número é a resposta pedida, não um comando de lançamento', async () => {
        await send('A', 'criar conta fixa 120 internet');

        // "20 mercado" seria um gasto novo se o estado pendente não decidisse antes do matcher.
        const reply = await send('A', '20 mercado');

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: `${REPLIES.firstDueFormat}\n${REPLIES.askFirstDue}` });
        expect(reply.draft).toMatchObject({ kind: 'RECURRING', pendingField: 'firstDueDate' });
        expect(transactions.create).not.toHaveBeenCalled();
      });

      it('valor sem descrição pergunta a descrição antes do valor', async () => {
        const reply = await send('A', 'criar conta fixa 120');

        expect(reply.draft).toMatchObject({ pendingField: 'description', amount: null });
        expect(reply.text).toBe(REPLIES.askDraftDescription);
      });

      it('resposta de valor com texto extra pede reenvio, sem trocar o campo', async () => {
        await send('A', 'criar conta fixa internet');
        const reply = await send('A', '12 internet');

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: `${REPLIES.amountOnly}\n${REPLIES.askRecurringAmount}` });
        expect(reply.draft).toMatchObject({ pendingField: 'amount' });
      });

      it('data passada é recusada na abertura, sem rascunho e com a orientação da tela', async () => {
        const reply = await send('A', 'criar conta fixa 120 internet primeiro 14/11/2026');

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.firstDuePast });
        expect(db.sessions).toHaveLength(0);
        expect(recurringEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.ERROR });
      });

      it('data inexistente (31/02) e mais de dois anos são recusadas sem rascunho', async () => {
        expect(await send('A', 'criar conta fixa 120 internet primeiro 31/02/2027')).toMatchObject({ kind: 'ERROR', text: REPLIES.invalidDate });
        expect(await send('A', 'criar conta fixa 120 internet primeiro 16/11/2028')).toMatchObject({ kind: 'ERROR', text: REPLIES.firstDueTooFar });
        expect(db.sessions).toHaveLength(0);
      });

      it('data que não é dd/mm nem dd/mm/aaaa (amanhã, dia 5, ISO) pede data completa, sem gravar', async () => {
        for (const due of ['amanhã', 'dia 5', '2026-11-20']) {
          const reply = await send('A', `criar conta fixa 120 internet primeiro ${due}`);
          expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askFirstDue });
          db.sessions.length = 0;
        }
      });

      it('"primeiro" sem data pede a data; "primeiro curso" continua descrição', async () => {
        const semData = await send('A', 'criar conta fixa 120 internet primeiro');
        expect(semData.draft).toMatchObject({ pendingField: 'firstDueDate' });
        db.sessions.length = 0;

        const curso = await send('A', 'criar conta fixa 120 primeiro curso de inglês');
        expect(rowValue(curso, 'Descrição')).toEqual(['primeiro curso de inglês']);
        expect(curso.draft).toMatchObject({ pendingField: 'firstDueDate' });
      });

      it('valor zero recusado na abertura; valor com sinal recusado', async () => {
        expect(await send('A', 'criar conta fixa 0 internet')).toMatchObject({ kind: 'ERROR', text: REPLIES.amountZero });
        expect(await send('A', 'criar conta fixa -5 internet')).toMatchObject({ kind: 'ERROR', text: REPLIES.amountNegative });
        expect(db.sessions).toHaveLength(0);
      });

      it('plano sem vaga recusa ao abrir, com a mensagem da exceção, sem rascunho', async () => {
        const { PlanLimitException: Limit } = await import('../billing/plan-limit.exception');
        const error = new Limit({ resource: 'recurringTransactions', limit: 3, used: 3, plan: 'FREE' as never });
        entitlements.assertCanCreate.mockRejectedValueOnce(error);

        const reply = await send('A', 'criar conta fixa 120 internet primeiro 20/11/2026');

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: error.message });
        expect(db.sessions).toHaveLength(0);
        expect(entitlements.assertCanCreate).toHaveBeenLastCalledWith('A', 'recurringTransactions');
      });

      it('comando novo com rascunho em andamento não substitui o rascunho', async () => {
        await send('A', 'criar reserva 400 gasolina');
        const reply = await send('A', 'criar conta fixa 120 internet primeiro 20/11/2026');

        expect(reply.text).toContain(REPLIES.confirmReminder);
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0]).toMatchObject({ intent: 'create_envelope' });
      });
    });

    describe('confirmação da conta fixa', () => {
      it('confirmar grava uma vez com o recibo: DONE, texto e data em recurringTransactionId', async () => {
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(recurring.createForConversation).toHaveBeenCalledTimes(1);
        expect(recurring.createForConversation).toHaveBeenCalledWith(
          'A',
          { type: 'EXPENSE', description: 'internet', amount: 120, frequency: 'MONTHLY', firstDueDate: '2026-11-20' },
          { notBefore: 'today' },
        );
        expect(reply).toEqual({
          kind: 'DONE',
          state: 'IDLE',
          text: `Conta fixa criada: internet, ${formatBrl(12000)}, mensal, primeiro vencimento em 20/11/2026.`,
          data: { recurringTransactionId: 'rec-9' },
        });
        expect(recurringEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.COMPLETED, resultRef: 'rec-9' });
        expect(db.sessions).toHaveLength(0);
      });

      it('materialização pendente: DONE com o aviso da tela de Finanças', async () => {
        recurring.createForConversation.mockResolvedValueOnce({
          id: 'rec-9', description: 'internet', amountCents: 12000, frequency: 'MONTHLY',
          firstDueDate: '2026-11-20', materializationPending: true, refreshPending: false,
        });
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('DONE');
        expect(reply.text).toBe(`Conta fixa criada: internet, ${formatBrl(12000)}, mensal, primeiro vencimento em 20/11/2026.\n${REPLIES.materializationPending}`);
      });

      it('atualização pendente: DONE com o aviso de dados, sem erro', async () => {
        recurring.createForConversation.mockResolvedValueOnce({
          id: 'rec-9', description: 'internet', amountCents: 12000, frequency: 'MONTHLY',
          firstDueDate: '2026-11-20', materializationPending: false, refreshPending: true,
        });
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('DONE');
        expect(reply.text.endsWith(REPLIES.refreshPending)).toBe(true);
      });

      it('commit de resultado desconhecido: ERROR, sem restaurar, sem liberar a chave', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new RecurringWriteUncertainError());
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toEqual({ kind: 'ERROR', state: 'IDLE', text: REPLIES.writeUncertain });
        expect(db.sessions).toHaveLength(0);
        expect(recurringEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.ERROR, appliedKey: `${draft.draftId}:1` });
        expect(await confirm('A', draft.draftId, draft.draftVersion)).toBeNull();
      });

      it('falha comprovada antes da gravação restaura o rascunho (D5)', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new Error('falha de banco'));
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: ConversationState.AWAITING_CONFIRMATION, text: REPLIES.recurringSaveFailed });
        expect(db.sessions[0]).toMatchObject({ version: 1, state: ConversationState.AWAITING_CONFIRMATION });
        expect(recurringEvents().at(-1)).toMatchObject({ appliedKey: null });
      });

      it('erro 4xx do serviço descarta o rascunho com texto seguro, sem vazar a mensagem', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new BadRequestException('detalhe interno do domínio'));
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.recurringRejected });
        expect(reply.text).not.toContain('domínio');
        expect(db.sessions).toHaveLength(0);
      });

      it('vencimento que ficou no passado entre rascunho e confirmação: sem gravar, pede nova data em 15 minutos', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new RecurringFirstDueChangedError('2026-11-20'));
        const draft = await recurringDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({
          kind: 'ASK_FIELD',
          state: ConversationState.COLLECTING_FIELDS,
          text: `${REPLIES.firstDueChanged}\n${REPLIES.askFirstDue}`,
        });
        expect(reply.draft).toMatchObject({ draftVersion: 2, pendingField: 'firstDueDate' });
        expect(rowValue(reply, 'Primeiro vencimento')).toEqual(['a informar']);
        expect(rowValue(reply, 'Atenção')).toEqual([REPLIES.firstDueChanged]);
        expect(db.sessions[0]).toMatchObject({ version: 2, state: ConversationState.COLLECTING_FIELDS });
        expect(new Date(db.sessions[0].expiresAt).getTime()).toBe(withinMinutes(15).getTime());
        expect(await confirm('A', draft.draftId, draft.draftVersion)).toBeNull();
      });

      it('nova data depois da revisão grava uma vez com a data nova', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new RecurringFirstDueChangedError('2026-11-16'));
        const draft = await recurringDraft();
        await confirm('A', draft.draftId, draft.draftVersion);

        const asked = await send('A', 'amanhã');
        expect(asked).toMatchObject({ kind: 'ASK_FIELD', text: `${REPLIES.firstDueFormat}\n${REPLIES.askFirstDue}` });

        const revised = await send('A', '17/11/2026');
        expect(revised.kind).toBe('CONFIRM_DRAFT');
        expect(revised.draft).toMatchObject({ draftVersion: 3 });
        // O motivo da revisão foi atendido pela nova data: não fica no cartão novo.
        expect(rowValue(revised, 'Atenção')).toEqual([]);

        await confirm('A', draft.draftId, 3);
        expect(recurring.createForConversation).toHaveBeenCalledTimes(2);
        expect(recurring.createForConversation.mock.calls[1][1]).toMatchObject({ firstDueDate: '2026-11-17' });
      });

      it('data passada na tela de revisão não grava: a data antiga nunca é aplicada', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new RecurringFirstDueChangedError('2026-11-16'));
        const draft = await recurringDraft();
        await confirm('A', draft.draftId, draft.draftVersion);

        const reply = await send('A', '15/11/2026');
        expect(reply).toMatchObject({ kind: 'CONFIRM_DRAFT' });
        // 15/11 é hoje (aceito pelo núcleo), mas o núcleo confere de novo na confirmação.
        expect(rowValue(reply, 'Primeiro vencimento')).toEqual(['15/11/2026']);
      });

      it('duas confirmações em paralelo criam uma só conta fixa', async () => {
        const draft = await recurringDraft();

        const [first, second] = await Promise.all([
          confirm('A', draft.draftId, draft.draftVersion),
          confirm('A', draft.draftId, draft.draftVersion),
        ]);

        expect([first?.kind, second?.kind].sort()).toEqual(['DONE', 'DUPLICATE']);
        expect(recurring.createForConversation).toHaveBeenCalledTimes(1);
      });

      it('versão antiga e "confirmar" de quem não é dono não gravam', async () => {
        const draft = await recurringDraft();

        expect(await confirm('A', draft.draftId, draft.draftVersion + 1)).toBeNull();
        expect(await confirm('B', draft.draftId, draft.draftVersion)).toBeNull();
        expect((await send('B', 'confirmar')).kind).toBe('HELP');
        expect(recurring.createForConversation).not.toHaveBeenCalled();
      });

      it('o id do dono vem do motor (argumento), nunca do texto', async () => {
        const draft = await recurringDraft();
        await confirm('A', draft.draftId, draft.draftVersion);

        expect(recurring.createForConversation.mock.calls[0][0]).toBe('A');
      });

      it('evento não guarda a descrição nem o valor', async () => {
        const draft = await recurringDraft();
        await confirm('A', draft.draftId, draft.draftVersion);

        // Os ids são UUIDs aleatórios e podem conter '120': só os campos de conteúdo entram na checagem.
        const serialized = JSON.stringify(db.events, (key, value) =>
          ['id', 'messageId', 'appliedKey'].includes(key) ? undefined : value,
        );
        expect(serialized).not.toContain('internet');
        expect(serialized).not.toContain('120');
        expect(serialized).not.toContain('12000');
      });

      it('GET /session mostra o cartão e a linha Atenção depois da revisão', async () => {
        recurring.createForConversation.mockRejectedValueOnce(new RecurringFirstDueChangedError('2026-11-16'));
        const draft = await recurringDraft();
        await confirm('A', draft.draftId, draft.draftVersion);

        const session = await service.getSession('A');

        expect(session.state).toBe(ConversationState.COLLECTING_FIELDS);
        expect(session.draft).toMatchObject({ kind: 'RECURRING', pendingField: 'firstDueDate', draftVersion: 2 });
        expect(session.draft?.rows.map((row) => row.label)).toContain('Atenção');
      });
    });

    describe('abertura e confirmação da compra parcelada', () => {
      it('total, quantidade e divisão aparecem no cartão; categoria e pagamento não informados', async () => {
        const reply = await send('A', 'criar parcelado 1200 geladeira em 12x primeiro 20/11/2026');

        expect(reply.kind).toBe('CONFIRM_DRAFT');
        expect(reply.draft).toMatchObject({ kind: 'INSTALLMENT', title: 'Compra parcelada', pendingField: null });
        expect(rowValue(reply, 'Total da compra')).toEqual([formatBrl(120000)]);
        expect(rowValue(reply, 'Quantidade')).toEqual(['12']);
        expect(rowValue(reply, 'Valor por parcela')).toEqual([formatBrl(10000)]);
        expect(rowValue(reply, 'Última parcela')).toEqual([formatBrl(10000)]);
        expect(rowValue(reply, 'Categoria')).toEqual(['não informada']);
        expect(rowValue(reply, 'Forma de pagamento')).toEqual(['não informada']);
        expect(installments.createForConversation).not.toHaveBeenCalled();
      });

      it('divisão com sobra: 100 em 3 vezes mostra 33,33 e última 33,34', async () => {
        const reply = await send('A', 'criar parcelado 100 geladeira em 3x primeiro 20/11/2026');

        expect(rowValue(reply, 'Valor por parcela')).toEqual([formatBrl(3333)]);
        expect(rowValue(reply, 'Última parcela')).toEqual([formatBrl(3334)]);
      });

      it('regressão: R$ 1,00 em 60 vezes é recusado na abertura, sem rascunho', async () => {
        const reply = await send('A', 'criar parcelado 1 geladeira em 60x primeiro 20/11/2026');

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.installmentTooSmall });
        expect(db.sessions).toHaveLength(0);
      });

      it('"12x de 100" não vira total de R$ 100: pede o total', async () => {
        const reply = await send('A', 'criar parcelado 12x de 100');

        expect(reply).toMatchObject({ kind: 'ERROR', text: REPLIES.installmentTotalOnly });
        expect(db.sessions).toHaveLength(0);
      });

      it('quantidade 1, 61 e fracionária são recusadas na abertura', async () => {
        for (const quantity of ['1x', '61x', '1,5x']) {
          expect(await send('A', `criar parcelado 1200 geladeira em ${quantity}`)).toMatchObject({ kind: 'ERROR', text: REPLIES.installmentsRange });
        }
        expect(db.sessions).toHaveLength(0);
      });

      it('sem quantidade, pergunta a quantidade; resposta "12" e "12x" são aceitas', async () => {
        const reply = await send('A', 'criar parcelado 1200 geladeira');
        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: REPLIES.askInstallmentsTotal });
        expect(reply.draft).toMatchObject({ pendingField: 'installmentsTotal' });

        const doze = await send('A', '12');
        expect(doze.draft).toMatchObject({ pendingField: 'firstDueDate' });
        expect(rowValue(doze, 'Quantidade')).toEqual(['12']);

        db.sessions.length = 0;
        await send('A', 'criar parcelado 1200 geladeira');
        const dozeX = await send('A', '12x');
        expect(dozeX.draft).toMatchObject({ pendingField: 'firstDueDate' });
        expect(rowValue(dozeX, 'Quantidade')).toEqual(['12']);
      });

      it('resposta de quantidade fora de 2 a 60 pede de novo, sem trocar o campo', async () => {
        await send('A', 'criar parcelado 1200 geladeira');

        const reply = await send('A', '1');

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', text: `${REPLIES.installmentsRange}\n${REPLIES.askInstallmentsTotal}` });
        expect(reply.draft).toMatchObject({ pendingField: 'installmentsTotal' });
        expect(rowValue(reply, 'Quantidade')).toEqual(['a informar']);
      });

      it('quantidade que deixa uma parcela abaixo de R$ 0,01 é recusada antes de guardar', async () => {
        await send('A', 'criar parcelado 1 geladeira');

        const reply = await send('A', '60');

        expect(reply.text).toBe(`${REPLIES.installmentTooSmall}\n${REPLIES.askInstallmentsTotal}`);
        expect(reply.draft).toMatchObject({ pendingField: 'installmentsTotal' });
        expect(rowValue(reply, 'Quantidade')).toEqual(['a informar']);
      });

      it('valor total depois da quantidade também é conferido (preço que não fecha a divisão)', async () => {
        await send('A', 'criar parcelado geladeira em 60x');

        const reply = await send('A', '1');

        expect(reply.text).toBe(`${REPLIES.installmentTooSmall}\n${REPLIES.askInstallmentTotal}`);
        expect(reply.draft).toMatchObject({ pendingField: 'amount' });
        expect(rowValue(reply, 'Total da compra')).toEqual(['a informar']);
      });

      it('confirmar grava uma vez com total em reais e recibo; DONE com a compra', async () => {
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(installments.createForConversation).toHaveBeenCalledTimes(1);
        expect(installments.createForConversation).toHaveBeenCalledWith(
          'A',
          { description: 'geladeira', totalAmount: 1200, installmentsTotal: 12, firstDueDate: '2026-11-20' },
          { notBefore: 'today' },
        );
        expect(reply).toEqual({
          kind: 'DONE',
          state: 'IDLE',
          text: `Compra parcelada criada: geladeira, total ${formatBrl(120000)} em 12 parcelas, primeira em 20/11/2026.`,
          data: { installmentPurchaseId: 'inst-9' },
        });
        expect(installmentEvents().at(-1)).toMatchObject({ outcome: ConversationOutcome.COMPLETED, resultRef: 'inst-9' });
      });

      it('materialização pendente: DONE do parcelado com o aviso da tela de Finanças, sem novo rascunho', async () => {
        installments.createForConversation.mockResolvedValueOnce({
          id: 'inst-9', description: 'geladeira', totalCents: 120000, installmentsTotal: 12, installmentCents: 10000,
          lastInstallmentCents: 10000, firstDueDate: '2026-11-20', materializationPending: true, refreshPending: false,
        });
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('DONE');
        expect(reply.text).toBe(
          `Compra parcelada criada: geladeira, total ${formatBrl(120000)} em 12 parcelas, primeira em 20/11/2026.\n${REPLIES.materializationPending}`,
        );
        expect(reply.data).toEqual({ installmentPurchaseId: 'inst-9' });
        expect(db.sessions).toHaveLength(0);
      });

      it('atualização pendente: DONE do parcelado com o aviso de dados, sem erro nem restauração', async () => {
        installments.createForConversation.mockResolvedValueOnce({
          id: 'inst-9', description: 'geladeira', totalCents: 120000, installmentsTotal: 12, installmentCents: 10000,
          lastInstallmentCents: 10000, firstDueDate: '2026-11-20', materializationPending: false, refreshPending: true,
        });
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply.kind).toBe('DONE');
        expect(reply.text.endsWith(REPLIES.refreshPending)).toBe(true);
        expect(reply.text).not.toContain(REPLIES.materializationPending);
        expect(db.sessions).toHaveLength(0);
      });

      it('parcela mínima recusada pelo serviço descarta com texto seguro', async () => {
        installments.createForConversation.mockRejectedValueOnce(new BadRequestException('detalhe do domínio'));
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: 'IDLE', text: REPLIES.installmentRejected });
        expect(reply.text).not.toContain('domínio');
      });

      it('commit de resultado desconhecido não restaura nem libera a chave', async () => {
        installments.createForConversation.mockRejectedValueOnce(new InstallmentWriteUncertainError());
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toEqual({ kind: 'ERROR', state: 'IDLE', text: REPLIES.writeUncertain });
        expect(db.sessions).toHaveLength(0);
        expect(installmentEvents().at(-1)).toMatchObject({ appliedKey: `${draft.draftId}:1` });
      });

      it('falha comprovada antes da gravação restaura o rascunho do parcelado', async () => {
        installments.createForConversation.mockRejectedValueOnce(new Error('falha de banco'));
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ERROR', state: ConversationState.AWAITING_CONFIRMATION, text: REPLIES.installmentSaveFailed });
        expect(db.sessions).toHaveLength(1);
      });

      it('primeiro vencimento passado depois da confirmação volta a pedir data', async () => {
        installments.createForConversation.mockRejectedValueOnce(new InstallmentFirstDueChangedError('2026-11-16'));
        const draft = await installmentDraft();

        const reply = await confirm('A', draft.draftId, draft.draftVersion);

        expect(reply).toMatchObject({ kind: 'ASK_FIELD', state: ConversationState.COLLECTING_FIELDS, text: `${REPLIES.firstDueChanged}\n${REPLIES.askFirstDue}` });
        expect(reply.draft).toMatchObject({ draftVersion: 2, pendingField: 'firstDueDate' });
      });

      it('plano de compras parceladas sem vaga recusa ao abrir', async () => {
        const { PlanLimitException: Limit } = await import('../billing/plan-limit.exception');
        const error = new Limit({ resource: 'installmentPurchases', limit: 2, used: 2, plan: 'FREE' as never });
        entitlements.assertCanCreate.mockRejectedValueOnce(error);

        const reply = await send('A', 'criar parcelado 1200 geladeira em 12x primeiro 20/11/2026');

        expect(reply).toMatchObject({ kind: 'ERROR', text: error.message });
        expect(db.sessions).toHaveLength(0);
        expect(entitlements.assertCanCreate).toHaveBeenLastCalledWith('A', 'installmentPurchases');
      });

      it('leituras "contas fixas" e "parcelas" continuam leituras, sem rascunho', async () => {
        expect((await send('A', 'contas fixas')).kind).toBe('INFO');
        expect((await send('A', 'parcelas')).kind).toBe('INFO');
        expect(db.sessions).toHaveLength(0);
      });
    });
  });
});
