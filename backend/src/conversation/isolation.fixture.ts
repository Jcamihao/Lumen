/**
 * Mundo em memoria para os testes de isolamento A/B/C (item 6). Nao entra no build (tsconfig.build.json).
 *
 * O fake de Prisma abaixo RESPEITA todo `where`: igualdade, `in`, `gt/gte/lt/lte` e `null`. Operador que ele
 * nao conhece lanca erro, para um filtro nunca ser ignorado em silencio. Sem isso, um teste de isolamento
 * passaria mesmo se o `userId` fosse retirado da consulta.
 *
 * Os servicos de dominio sao fakes que leem so as linhas do `userId` recebido (como os reais). Cada chamada
 * fica registrada em `world.calls` para os testes conferirem com que `userId` o motor chamou.
 */
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConversationService } from './conversation.service';
import { WhatsappLinkService } from '../whatsapp/whatsapp-link.service';
import { WhatsappAdapterService } from '../whatsapp/whatsapp-adapter.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const T0 = new Date('2026-11-15T12:00:00.000Z');
export const SESSION_ID = 'lumen-teste';
export const WEBHOOK_SECRET = 'segredo-de-teste-do-webhook';

export type Who = 'A' | 'B' | 'C';
export const WHO: Who[] = ['A', 'B', 'C'];
export const USER_ID: Record<Who, string> = { A: 'user-A', B: 'user-B', C: 'user-C' };
export const JID: Record<Who, string> = {
  A: '5511900000001@s.whatsapp.net',
  B: '5521900000002@s.whatsapp.net',
  C: '5531900000003@s.whatsapp.net',
};

/** Dados que só a conta dona pode ver. Os testes procuram o "veneno" das outras contas em toda resposta. */
export const SECRETS: Record<Who, { balance: string; goal: string; category: string; recurring: string }> = {
  A: { balance: '1.234,56', goal: 'Viagem Zeta', category: 'Mercado Zeta', recurring: 'Internet Zeta' },
  B: { balance: '7.777,77', goal: 'Moto Beta', category: 'Padaria Beta', recurring: 'Aluguel Beta' },
  C: { balance: '4.242,42', goal: 'Casa Gama', category: 'Farmacia Gama', recurring: 'Escola Gama' },
};

function opMatches(actual: unknown, op: string, value: unknown): boolean {
  const a = actual as number | Date;
  const v = value as number | Date;
  switch (op) {
    case 'in':
      return (value as unknown[]).includes(actual);
    case 'gt':
      return actual !== null && actual !== undefined && a > v;
    case 'gte':
      return actual !== null && actual !== undefined && a >= v;
    case 'lt':
      return actual !== null && actual !== undefined && a < v;
    case 'lte':
      return actual !== null && actual !== undefined && a <= v;
    default:
      throw new Error(`fake de Prisma: operador "${op}" nao suportado`);
  }
}

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (expected === null) return (row[key] ?? null) === null;
    if (expected instanceof Date) return row[key] instanceof Date && row[key].getTime() === expected.getTime();
    if (typeof expected === 'object') {
      return Object.entries(expected).every(([op, value]) => opMatches(row[key], op, value));
    }
    return row[key] === expected;
  });
}

const clone = <T>(value: T): T => (value === null || value === undefined ? value : structuredClone(value));

export function uniqueViolation(target: string[] = []): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
}

export class World {
  sessions: Row[] = [];

  /** Forma de lançamento que o motor lê (campos de vínculo sempre presentes, como no Prisma). */
  transactionView(tx: Row): Row {
    const category = this.categories.find((row) => row.id === tx.categoryId);
    return {
      description: '',
      createdAt: T0,
      updatedAt: T0,
      categoryId: null,
      recurringTransactionId: null,
      installmentPurchaseId: null,
      linkedGoalId: null,
      receiptScan: null,
      ...tx,
      amount: String(tx.amount),
      category: category ? { name: category.name } : null,
    };
  }
  events: Row[] = [];
  links: Row[] = [];
  linkCodes: Row[] = [];
  categories: Row[] = [];
  /** 9b-1: cartoes por dono (A: Nubank; B: Itaú e Bradesco; C: nenhum). */
  cards: Row[] = [];
  goals: Row[] = [];
  transactions: Row[] = [];
  envelopes: Row[] = [];
  recurring: Row[] = [];
  installments: Row[] = [];
  ceilings: Record<string, number> = {};
  timezones: Record<string, string> = {};
  /** Chamadas aos servicos de dominio: { method, userId }. */
  calls: Array<{ method: string; userId: string }> = [];
  /** Escritas pelo dominio (para provar que nada gravou). */
  domainWrites: Array<{ method: string; userId: string }> = [];
  /** Quando definido, o proximo evento criado com `appliedKey` devolve este id (simula colisao de id). */
  appliedEventIdOverride: string | null = null;

  /** Fake de Prisma com so o que o motor e o servico de vinculo usam. */
  prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({
        timezone: this.timezones[where.id] ?? 'America/Sao_Paulo',
      })),
    },
    envelope: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(this.envelopes.find((row) => matches(row, where)) ?? null)),
    },
    conversationSession: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(this.sessions.find((row) => matches(row, where)) ?? null)),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = this.sessions.length;
        for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
          if (matches(this.sessions[index], where)) this.sessions.splice(index, 1);
        }
        return { count: before - this.sessions.length };
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (this.sessions.some((row) => row.userId === data.userId && row.channel === data.channel)) throw uniqueViolation();
        if (data.id && this.sessions.some((row) => row.id === data.id)) throw uniqueViolation();
        const row = { id: data.id ?? randomUUID(), version: 1, ...data };
        this.sessions.push(row);
        return clone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = this.sessions.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    conversationEvent: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(this.events.find((row) => matches(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (data.appliedKey && this.events.some((row) => row.appliedKey === data.appliedKey)) throw uniqueViolation(['appliedKey']);
        if (
          data.messageId !== null &&
          data.messageId !== undefined &&
          this.events.some((row) => row.userId === data.userId && row.channel === data.channel && row.messageId === data.messageId)
        ) {
          throw uniqueViolation(['userId', 'channel', 'messageId']);
        }
        let id: string = randomUUID();
        if (data.appliedKey && this.appliedEventIdOverride) {
          // Colisao simulada: o id devolvido ja pertence a um evento de outra conta.
          id = this.appliedEventIdOverride;
          this.appliedEventIdOverride = null;
        }
        const row = { messageId: null, appliedKey: null, resultRef: null, ...data, id };
        this.events.push(row);
        return clone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = this.events.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    creditCard: {
      findMany: jest.fn(async ({ where }: { where: Row }) => clone(this.cards.filter((row) => matches(row, where)))),
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(this.cards.find((row) => matches(row, where)) ?? null)),
    },
    financeCategory: {
      findMany: jest.fn(async ({ where }: { where: Row }) => clone(this.categories.filter((row) => matches(row, where)))),
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(this.categories.find((row) => matches(row, where)) ?? null)),
    },
    transaction: {
      // Busca e leitura de editar/apagar (8a): respeita o where; campos novos com default de lançamento manual.
      findMany: jest.fn(async ({ where, take }: { where: Row; take?: number }) => {
        let rows = this.transactions.filter((tx) => matches(tx, where));
        rows = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        if (take !== undefined) rows = rows.slice(0, take);
        return clone(rows.map((tx) => this.transactionView(tx)));
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) => {
        const row = this.transactions.find((tx) => matches(tx, where));
        return row ? clone(this.transactionView(row)) : null;
      }),
      groupBy: jest.fn(async ({ where }: { where: Row }) => {
        const sums = new Map<string | null, number>();
        for (const row of this.transactions.filter((tx) => matches(tx, where))) {
          sums.set(row.categoryId ?? null, (sums.get(row.categoryId ?? null) ?? 0) + Number(row.amount));
        }
        return [...sums.entries()].map(([categoryId, sum]) => ({ categoryId, _sum: { amount: new Prisma.Decimal(sum) } }));
      }),
    },
    whatsappLink: {
      // Como o Prisma: where com chave unica. Aqui e leniente com `where` vazio (devolve a primeira linha),
      // para que retirar o filtro apareca como vazamento e nao como erro de validacao.
      findUnique: jest.fn(async ({ where }: { where: Row }) => clone(this.links.find((row) => matches(row, where)) ?? null)),
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (this.links.some((row) => row.jid === data.jid)) throw uniqueViolation(['jid']);
        if (this.links.some((row) => row.userId === data.userId)) throw uniqueViolation(['userId']);
        const row = { id: randomUUID(), createdAt: new Date(), ...data };
        this.links.push(row);
        return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = this.links.length;
        this.links = this.links.filter((row) => !matches(row, where));
        return { count: before - this.links.length };
      }),
    },
    whatsappLinkCode: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), usedAt: null, createdAt: new Date(), ...data };
        this.linkCodes.push(row);
        return clone(row);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = this.linkCodes.length;
        this.linkCodes = this.linkCodes.filter((row) => !matches(row, where));
        return { count: before - this.linkCodes.length };
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) => clone(this.linkCodes.find((row) => matches(row, where)) ?? null)),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const targets = this.linkCodes.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };

  private track(method: string, userId: string, write = false) {
    this.calls.push({ method, userId });
    if (write) this.domainWrites.push({ method, userId });
  }

  private goalRow(row: Row) {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      status: row.status,
      targetAmount: row.targetAmount,
      currentAmount: row.currentAmount,
      targetDate: null,
    };
  }

  /** Servicos de dominio fake: leem e gravam so linhas do userId recebido. */
  services = {
    creditCards: realCreditCardsService(this),
    dashboard: {
      getSummary: jest.fn(async (userId: string) => {
        this.track('dashboard.getSummary', userId);
        const own = this.transactions.filter((tx) => tx.userId === userId);
        const income = own.filter((tx) => tx.type === 'INCOME').reduce((sum, tx) => sum + Number(tx.amount), 0);
        const expense = own.filter((tx) => tx.type === 'EXPENSE').reduce((sum, tx) => sum + Number(tx.amount), 0);
        return { finances: { balance: income - expense, monthlyIncome: income, monthlyExpenses: expense } };
      }),
    },
    creditCycle: {
      getCycleForCard: jest.fn(async (userId: string, cardId: string) => {
        this.track('creditCycle.getCycleForCard', userId);
        if (!this.cards.some((row) => row.id === cardId && row.userId === userId)) {
          throw new NotFoundException('Cartao nao encontrado.');
        }
        return {
          closingDay: 5,
          dueDay: 12,
          countAllPayments: false,
          cycleStart: '2026-11-06T00:00:00.000Z',
          cycleEnd: '2026-12-05T00:00:00.000Z',
          ceiling: null,
          spent: 0,
          remaining: null,
          percentUsed: null,
          status: 'none',
        };
      }),
      getCurrent: jest.fn(async (userId: string) => {
        this.track('creditCycle.getCurrent', userId);
        const ceiling = this.ceilings[userId] ?? null;
        const spent = this.transactions
          .filter((tx) => tx.userId === userId && tx.type === 'EXPENSE' && tx.paymentMethod === 'CREDIT')
          .reduce((sum, tx) => sum + Number(tx.amount), 0);
        return {
          closingDay: 5,
          dueDay: 12,
          countAllPayments: false,
          cycleStart: '2026-11-06T00:00:00.000Z',
          cycleEnd: '2026-12-05T00:00:00.000Z',
          ceiling,
          spent,
          remaining: ceiling === null ? null : ceiling - spent,
          percentUsed: ceiling ? Math.floor((spent / ceiling) * 100) : null,
          status: ceiling === null ? 'none' : 'ok',
        };
      }),
      setCeilingForConversation: jest.fn(async (userId: string, dto: { ceiling: number }) => {
        this.track('creditCycle.setCeilingForConversation', userId, true);
        this.ceilings[userId] = dto.ceiling;
        return { id: randomUUID(), ceilingCents: Math.round(dto.ceiling * 100), cycleStart: '2026-11-06', cycleEnd: '2026-12-05', refreshPending: false };
      }),
    },
    transactions: {
      create: jest.fn(async (userId: string, dto: Row) => {
        this.track('transactions.create', userId, true);
        if (dto.categoryId && !this.categories.some((category) => category.id === dto.categoryId && category.userId === userId)) {
          throw new NotFoundException('Categoria financeira invalida.');
        }
        const row = { id: randomUUID(), userId, ...dto, amount: Math.abs(dto.amount) };
        this.transactions.push(row);
        return clone(row);
      }),
      update: jest.fn(async (userId: string, id: string, dto: Row) => {
        this.track('transactions.update', userId, true);
        const row = this.transactions.find((tx) => tx.id === id && tx.userId === userId);
        if (!row) throw new NotFoundException('Lançamento não encontrado');
        if (dto.categoryId && !this.categories.some((category) => category.id === dto.categoryId && category.userId === userId)) {
          throw new NotFoundException('Categoria financeira invalida.');
        }
        if (dto.amount !== undefined) row.amount = Math.abs(dto.amount);
        if (dto.description !== undefined) row.description = dto.description;
        if (dto.categoryId !== undefined) row.categoryId = dto.categoryId;
        if (dto.date !== undefined) row.date = new Date(dto.date);
        row.updatedAt = new Date(T0.getTime() + this.transactions.length);
        return clone(row);
      }),
      remove: jest.fn(async (userId: string, id: string) => {
        this.track('transactions.remove', userId, true);
        const index = this.transactions.findIndex((tx) => tx.id === id && tx.userId === userId);
        if (index === -1) throw new NotFoundException('Lançamento não encontrado');
        this.transactions.splice(index, 1);
        return { success: true };
      }),
    },
    goals: {
      list: jest.fn(async (userId: string) => {
        this.track('goals.list', userId);
        return this.goals.filter((goal) => goal.userId === userId).map((goal) => this.goalRow(goal));
      }),
      create: jest.fn(async (userId: string, dto: Row) => {
        this.track('goals.create', userId, true);
        const row = {
          id: randomUUID(),
          userId,
          title: dto.title,
          status: 'ACTIVE',
          targetAmount: dto.targetAmount ?? null,
          currentAmount: 0,
        };
        this.goals.push(row);
        return this.goalRow(row);
      }),
      contribute: jest.fn(async (userId: string, id: string, dto: Row) => {
        this.track('goals.contribute', userId, true);
        const goal = this.goals.find((row) => row.id === id && row.userId === userId);
        if (!goal) throw new NotFoundException('Meta nao encontrada.');
        goal.currentAmount = Number(goal.currentAmount) + dto.amount;
        this.transactions.push({ id: randomUUID(), userId, type: 'TRANSFER', amount: dto.amount, linkedGoalId: id });
        return this.goalRow(goal);
      }),
    },
    envelopes: {
      list: jest.fn(async (userId: string) => {
        this.track('envelopes.list', userId);
        return this.envelopes
          .filter((row) => row.userId === userId)
          .map((row) => ({ name: row.name, isActive: true, monthlyAmount: row.monthlyAmount, available: row.monthlyAmount, spent: 0 }));
      }),
      createForConversation: jest.fn(async (userId: string, dto: Row) => {
        this.track('envelopes.createForConversation', userId, true);
        const row = { id: randomUUID(), userId, name: dto.name, monthlyAmount: dto.monthlyAmount };
        this.envelopes.push(row);
        return { id: row.id, name: row.name, monthlyCents: Math.round(dto.monthlyAmount * 100), provisionMonth: '2026-11-01', refreshPending: false };
      }),
    },
    recurring: {
      list: jest.fn(async (userId: string) => {
        this.track('recurring.list', userId);
        return this.recurring.filter((row) => row.userId === userId);
      }),
      createForConversation: jest.fn(async (userId: string, dto: Row) => {
        this.track('recurring.createForConversation', userId, true);
        const row = { id: randomUUID(), userId, type: 'EXPENSE', isActive: true, nextDueDate: new Date(`${dto.firstDueDate}T00:00:00.000Z`), ...dto };
        this.recurring.push(row);
        return {
          id: row.id,
          description: dto.description,
          amountCents: Math.round(dto.amount * 100),
          frequency: dto.frequency,
          firstDueDate: dto.firstDueDate,
          materializationPending: false,
          refreshPending: false,
        };
      }),
    },
    installments: {
      list: jest.fn(async (userId: string) => {
        this.track('installments.list', userId);
        return this.installments.filter((row) => row.userId === userId);
      }),
      createForConversation: jest.fn(async (userId: string, dto: Row) => {
        this.track('installments.createForConversation', userId, true);
        const row = { id: randomUUID(), userId, ...dto };
        this.installments.push(row);
        return {
          id: row.id,
          description: dto.description,
          totalCents: Math.round(dto.totalAmount * 100),
          installmentsTotal: dto.installmentsTotal,
          installmentCents: Math.round((dto.totalAmount / dto.installmentsTotal) * 100),
          lastInstallmentCents: 0,
          firstDueDate: dto.firstDueDate,
          materializationPending: false,
          refreshPending: false,
        };
      }),
    },
    entitlements: {
      assertCanCreate: jest.fn(async (userId: string, resource: string) => {
        this.track(`entitlements.assertCanCreate:${resource}`, userId);
      }),
    },
  };

  /** Escritas feitas pelo dominio, de qualquer conta. */
  get writeCount(): number {
    return this.domainWrites.length;
  }

  /** Tudo que cada conta tem hoje, para conferir "nao mudou" sem depender de contagem solta. */
  snapshot(userId: string) {
    return {
      transactions: this.transactions.filter((row) => row.userId === userId).map((row) => row.id),
      goals: this.goals.filter((row) => row.userId === userId).map((row) => ({ id: row.id, current: row.currentAmount })),
      envelopes: this.envelopes.filter((row) => row.userId === userId).map((row) => row.id),
      recurring: this.recurring.filter((row) => row.userId === userId).map((row) => row.id),
      installments: this.installments.filter((row) => row.userId === userId).map((row) => row.id),
      ceiling: this.ceilings[userId] ?? null,
    };
  }
}

/** Contas A, B e C, cada uma com saldo, categoria, meta, cartao, conta fixa e parcelado proprios. */
/**
 * CreditCardsService REAL sobre o mundo fake (9b-3): nome unico, cartao ativo e lock do User vem do servico de verdade.
 * O fake de Prisma honra `where` (matches) e a transacao interativa roda sobre o mesmo mundo.
 */
export function realCreditCardsService(world: World): CreditCardsService {
  const creditCard = {
    count: jest.fn(async ({ where }: { where: Row }) => world.cards.filter((row) => matches(row, where)).length),
    findMany: jest.fn(async ({ where }: { where: Row }) => clone(world.cards.filter((row) => matches(row, where)))),
    findFirst: jest.fn(async ({ where }: { where: Row }) => clone(world.cards.find((row) => matches(row, where)) ?? null)),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: randomUUID(), archivedAt: null, ...data };
      world.cards.push(row);
      return clone(row);
    }),
    update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = world.cards.find((card) => matches(card, where));
      if (!row) throw new Error('registro de cartao nao encontrado no fake');
      for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
      return clone(row);
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const targets = world.cards.filter((row) => matches(row, where));
      targets.forEach((row) => Object.assign(row, data));
      return { count: targets.length };
    }),
  };
  const prisma: Row = {
    creditCard,
    user: { update: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: (tx: Row) => Promise<unknown>) => fn(prisma)),
  };
  const service = new CreditCardsService(
    prisma as never,
    { touchUserData: jest.fn(async () => undefined) } as never,
    {} as never,
    // Limite por plano (D7) e no-op neste fixture: o teto tecnico de 10 continua valendo.
    { assertCanCreate: jest.fn(async () => undefined) } as never,
  );
  // Spy que mantem a implementacao real: o teste conta chamadas e pode forcar uma falha pontual.
  jest.spyOn(service, 'update');
  jest.spyOn(service, 'create');
  return service;
}

export function seedWorld(): World {
  const world = new World();
  const plan: Record<Who, { income: number; expense: number; ceiling: number; goalTarget: number; goalCurrent: number; dueAmount: number }> = {
    A: { income: 10000, expense: 8765.44, ceiling: 2000, goalTarget: 3000, goalCurrent: 1000, dueAmount: 111 },
    B: { income: 9000, expense: 1222.23, ceiling: 5000, goalTarget: 8000, goalCurrent: 2500, dueAmount: 222 },
    C: { income: 5000, expense: 757.58, ceiling: 900, goalTarget: 1500, goalCurrent: 300, dueAmount: 333 },
  };
  for (const who of WHO) {
    const userId = USER_ID[who];
    const secret = SECRETS[who];
    const p = plan[who];
    world.timezones[userId] = 'America/Sao_Paulo';
    world.categories.push(
      { id: `cat-${who}-main`, userId, name: secret.category, type: 'EXPENSE' },
      { id: `cat-${who}-income`, userId, name: `Salario ${who}`, type: 'INCOME' },
    );
    world.transactions.push(
      { id: `tx-${who}-in`, userId, type: 'INCOME', amount: p.income, date: new Date('2026-11-02T00:00:00.000Z'), categoryId: `cat-${who}-income` },
      { id: `tx-${who}-out`, userId, type: 'EXPENSE', amount: p.expense, date: new Date('2026-11-03T00:00:00.000Z'), categoryId: `cat-${who}-main`, paymentMethod: 'CREDIT' },
    );
    world.goals.push({ id: `goal-${who}`, userId, title: secret.goal, status: 'ACTIVE', targetAmount: p.goalTarget, currentAmount: p.goalCurrent });
    world.ceilings[userId] = p.ceiling;
    world.recurring.push({
      id: `rec-${who}`,
      userId,
      description: secret.recurring,
      type: 'EXPENSE',
      frequency: 'MONTHLY',
      amount: p.dueAmount,
      isActive: true,
      nextDueDate: new Date('2026-11-20T00:00:00.000Z'),
    });
  }
  world.cards.push(
    { id: 'cr-A-nubank', userId: USER_ID.A, name: 'Nubank', isDefault: true, archivedAt: null, closingDay: 5, dueDay: 12 },
    { id: 'cr-B-itau', userId: USER_ID.B, name: 'Itaú', isDefault: true, archivedAt: null, closingDay: 5, dueDay: 12 },
    { id: 'cr-B-bradesco', userId: USER_ID.B, name: 'Bradesco', isDefault: false, archivedAt: null, closingDay: 8, dueDay: null },
  );
  return world;
}

export interface Engine {
  service: ConversationService;
  settings: { writesEnabled: boolean };
}

/** Motor real sobre o mundo fake. `settings.writesEnabled` liga e desliga a trava do WhatsApp na hora. */
export function buildEngine(world: World, writesEnabled = true): Engine {
  const settings = { writesEnabled };
  const config = { get: jest.fn((key: string) => (key === 'whatsapp.writesEnabled' ? settings.writesEnabled : undefined)) };
  const s = world.services;
  type Deps = ConstructorParameters<typeof ConversationService>;
  const service = new ConversationService(
    world.prisma as unknown as Deps[0],
    s.dashboard as unknown as Deps[1],
    s.creditCycle as unknown as Deps[2],
    s.transactions as unknown as Deps[3],
    s.recurring as unknown as Deps[4],
    s.installments as unknown as Deps[5],
    s.goals as unknown as Deps[6],
    s.envelopes as unknown as Deps[7],
    s.entitlements as unknown as Deps[8],
    config as unknown as Deps[9],
    { tryFallbackAnswer: jest.fn(async () => ({ status: 'unavailable' })) } as unknown as Deps[10],
    s.creditCards as unknown as Deps[11],
  );
  return { service, settings };
}

/** Contador em memoria com a forma do CacheQueueService.hitRateLimitWindow. */
export function fakeCache() {
  const counts = new Map<string, number>();
  return {
    counts,
    hitRateLimitWindow: jest.fn(async (key: string) => {
      const hits = (counts.get(key) ?? 0) + 1;
      counts.set(key, hits);
      return { hits, resetAfterMs: 1000 };
    }),
  };
}

export interface WhatsappStack {
  engine: Engine;
  links: WhatsappLinkService;
  adapter: WhatsappAdapterService;
  cache: ReturnType<typeof fakeCache>;
  sent: Array<{ jid: string; text: string }>;
  client: { sendText: jest.Mock };
  config: ConfigService;
}

/** Vinculo, adaptador e motor reais sobre o mundo fake; envio capturado em `sent`. */
export function buildWhatsapp(world: World, writesEnabled = true): WhatsappStack {
  const engine = buildEngine(world, writesEnabled);
  const values: Record<string, unknown> = {
    'whatsapp.enabled': true,
    'whatsapp.waAkgSessionId': SESSION_ID,
    'whatsapp.waAkgWebhookSecret': WEBHOOK_SECRET,
    'whatsapp.contactNumber': '5511999990000',
  };
  const config = { get: (key: string) => (key === 'whatsapp.writesEnabled' ? engine.settings.writesEnabled : values[key]) } as unknown as ConfigService;
  const links = new WhatsappLinkService(world.prisma as never, config);
  const cache = fakeCache();
  const sent: Array<{ jid: string; text: string }> = [];
  const client = { sendText: jest.fn(async (jid: string, text: string) => void sent.push({ jid, text })) };
  const adapter = new WhatsappAdapterService(config, cache as never, links, engine.service, client as never);
  return { engine, links, adapter, cache, sent, client, config };
}

/** Evento de mensagem recebida, no formato do WA-AKG. */
export function inbound(who: Who | string, text: string, id: string, extra: { data?: Row; top?: Row } = {}) {
  const jid = who in JID ? JID[who as Who] : who;
  return {
    event: 'message.received',
    sessionId: SESSION_ID,
    timestamp: '2026-11-15T12:00:00.000Z',
    data: {
      key: { id, remoteJid: jid, fromMe: false },
      pushName: 'Nome',
      from: jid,
      isGroup: false,
      chatType: 'PERSONAL',
      type: 'text',
      content: text,
      ...extra.data,
    },
    ...extra.top,
  };
}

/** Vincula A, B e C pelo caminho real (codigo gerado na conta, enviado do WhatsApp). */
export async function linkAll(world: World, stack: WhatsappStack): Promise<void> {
  for (const who of WHO) {
    const { code } = await stack.links.createCode(USER_ID[who]);
    await stack.adapter.handleInbound(inbound(who, code, `link-${who}`));
  }
  stack.sent.length = 0;
  void world;
}

/** Palavra que casa a categoria de cada conta ("50 mercado"), e a palavra que casa a meta ("guardar 200 na viagem"). */
export const KEYWORD: Record<Who, { category: string; goal: string }> = {
  A: { category: 'mercado', goal: 'viagem' },
  B: { category: 'padaria', goal: 'moto' },
  C: { category: 'farmacia', goal: 'casa' },
};

/** Tudo que pertence a uma conta e que as outras nunca podem ver em nenhuma resposta. */
export function forbiddenFor(who: Who): string[] {
  const out: string[] = [];
  for (const other of WHO.filter((candidate) => candidate !== who)) {
    const s = SECRETS[other];
    out.push(s.balance, s.goal, s.category, s.recurring, USER_ID[other], `-${other}-`, `goal-${other}`, `cat-${other}`, `tx-${other}`, JID[other].split('@')[0]);
  }
  return out;
}
