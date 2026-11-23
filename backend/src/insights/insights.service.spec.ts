import { creditCycleBounds } from '../credit-cycle/credit-cycle.util';
import { localToday } from '../recurring-transactions/recurrence.util';
import { InsightSeverity, InsightType } from '@prisma/client';
import { addDays, subDays } from 'date-fns';
import { InsightsService } from './insights.service';

type ExpenseSeed = {
  id: string;
  description: string;
  amount: number;
  date: Date;
};

type ReceiptScanSeed = {
  id: string;
  merchantName: string;
  purchaseDate: Date;
  totalAmount: number;
  items: Array<{ description: string; totalPrice: number }>;
  tagGroupId: string;
  tagGroup: { name: string };
  compareWithPrevious: boolean;
};

type CategoryGroupSeed = {
  categoryId: string | null;
  _sum: { amount: number };
  _count: { _all: number };
};

const group = (categoryId: string | null, amount: number, count = 3): CategoryGroupSeed => ({
  categoryId,
  _sum: { amount },
  _count: { _all: count },
});

const buildPrisma = (
  expenses: ExpenseSeed[] = [],
  receiptScans: ReceiptScanSeed[] = [],
  userOverrides: Record<string, unknown> = {},
  goals: unknown[] = [],
  categorySpending: {
    current: CategoryGroupSeed[];
    previous: CategoryGroupSeed[];
    categories: Array<{ id: string; name: string; monthlyBudget?: number | null }>;
  } = { current: [], previous: [], categories: [] },
  recurringBills: unknown[] = [],
) => {
  const prisma = {
    insight: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn((args: any) => args),
    },
    $transaction: jest.fn().mockResolvedValue([]),
    creditCard: {
      findFirst: jest.fn().mockResolvedValue({ id: 'card-1' }),
    },
    creditCycleCeiling: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'user-1',
        monthlyIncome: 5000,
        preferredCurrency: 'BRL',
        createdAt: subDays(new Date(), 365),
        ...userOverrides,
      }),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    transaction: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          amount: 1200,
        },
      }),
      findMany: jest.fn().mockResolvedValue(expenses),
      // 1a chamada = mes corrente, 2a = mes anterior (mesma ordem do loadContext).
      groupBy: jest
        .fn()
        .mockResolvedValueOnce(categorySpending.current)
        .mockResolvedValueOnce(categorySpending.previous),
    },
    financeCategory: {
      findMany: jest.fn().mockResolvedValue(categorySpending.categories),
    },
    recurringTransaction: {
      findMany: jest.fn().mockResolvedValue(recurringBills),
    },
    goal: {
      findMany: jest.fn().mockResolvedValue(goals),
    },
    reminder: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    receiptScan: {
      findMany: jest.fn().mockResolvedValue(receiptScans),
    },
  } as any;

  return prisma;
};

/** Le os insights que o service mandou persistir, sem depender do retorno do banco. */
const generatedInsights = (prisma: any) =>
  prisma.insight.upsert.mock.calls.map((call: any[]) => ({
    ...call[0].create,
    fingerprint: call[0].where.userId_fingerprint.fingerprint,
  })) as Array<{
    type: InsightType;
    severity: InsightSeverity;
    message: string;
    fingerprint: string;
    metadata?: Record<string, unknown>;
  }>;

describe('InsightsService', () => {
  it('returns a calm insight when no risks are present', async () => {
    const prisma = buildPrisma();

    prisma.insight.findMany.mockResolvedValueOnce([
      {
        type: InsightType.ROUTINE,
        severity: InsightSeverity.INFO,
        message: 'Seu momento parece equilibrado: sem alertas relevantes agora, com espaco para focar no que acelera seus objetivos.',
      },
    ]);

    const service = new InsightsService(prisma);
    const insights = await service.refreshForUser('user-1');

    expect(insights).toHaveLength(1);
    expect(insights[0].severity).toBe(InsightSeverity.INFO);
  });

  describe('detectDuplicateCharges', () => {
    it('flags the same charge repeated within the duplicate window', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 10) },
        { id: 't2', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 9) },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const duplicate = generatedInsights(prisma).find(
        (insight) =>
          insight.type === InsightType.FINANCE &&
          insight.severity === InsightSeverity.WARNING,
      );

      expect(duplicate).toBeDefined();
      expect(duplicate?.message).toContain('Streaming Plus');
      expect(duplicate?.metadata?.duplicates).toHaveLength(1);
    });

    it('ignores a monthly charge, which is recurrence and not duplicity', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Academia', amount: 120, date: subDays(now, 60) },
        { id: 't2', description: 'Academia', amount: 120, date: subDays(now, 30) },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const duplicate = generatedInsights(prisma).find(
        (insight) => insight.metadata?.duplicates !== undefined,
      );

      expect(duplicate).toBeUndefined();
    });

    it('ignores charges with the same description but different amounts', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Mercado', amount: 80, date: subDays(now, 5) },
        { id: 't2', description: 'Mercado', amount: 240, date: subDays(now, 4) },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => insight.metadata?.duplicates !== undefined,
        ),
      ).toBeUndefined();
    });
  });

  describe('detectRecurringCharges', () => {
    it('flags a charge repeating on a monthly cycle', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Assinatura Nuvem', amount: 29.9, date: subDays(now, 60) },
        { id: 't2', description: 'Assinatura Nuvem', amount: 29.9, date: subDays(now, 30) },
        { id: 't3', description: 'Assinatura Nuvem', amount: 29.9, date: now },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const subscription = generatedInsights(prisma).find(
        (insight) => insight.metadata?.subscriptions !== undefined,
      );

      expect(subscription).toBeDefined();
      expect(subscription?.severity).toBe(InsightSeverity.INFO);
      expect(subscription?.message).toContain('Assinatura Nuvem');
      expect(subscription?.metadata?.monthlyTotal).toBeCloseTo(29.9);
    });

    it('requires at least three occurrences', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Assinatura Nuvem', amount: 29.9, date: subDays(now, 30) },
        { id: 't2', description: 'Assinatura Nuvem', amount: 29.9, date: now },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => insight.metadata?.subscriptions !== undefined,
        ),
      ).toBeUndefined();
    });

    it('does not treat same-day duplicates as a monthly cycle', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Livraria', amount: 55, date: subDays(now, 30) },
        { id: 't2', description: 'Livraria', amount: 55, date: subDays(now, 30) },
        { id: 't3', description: 'Livraria', amount: 55, date: subDays(now, 30) },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => insight.metadata?.subscriptions !== undefined,
        ),
      ).toBeUndefined();
    });
  });

  describe('detectOverdueFinancialCost', () => {
    it('sums the estimated amount of overdue tasks with financial impact', async () => {
      const prisma = buildPrisma();
      prisma.task.findMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Renovar seguro do carro',
          hasFinancialImpact: true,
          estimatedAmount: 300,
          linkedGoalId: null,
        },
        {
          id: 'task-2',
          title: 'Pagar mensalidade do curso',
          hasFinancialImpact: true,
          estimatedAmount: 220,
          linkedGoalId: null,
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.totalEstimatedAmount !== undefined,
      );

      expect(insight).toBeDefined();
      expect(insight?.type).toBe(InsightType.PRODUCTIVITY);
      expect((insight?.metadata as any)?.totalEstimatedAmount).toBe(520);
      expect((insight?.metadata as any)?.tasks).toHaveLength(2);
    });

    it('ignores overdue tasks without financial impact', async () => {
      const prisma = buildPrisma();
      prisma.task.findMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Organizar mesa',
          hasFinancialImpact: false,
          estimatedAmount: null,
          linkedGoalId: null,
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.totalEstimatedAmount !== undefined,
        ),
      ).toBeUndefined();
    });

    it('escalates to critical when the amount reaches a quarter of the monthly income', async () => {
      const prisma = buildPrisma();
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        monthlyIncome: 2000,
        preferredCurrency: 'BRL',
      });
      prisma.task.findMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Consulta atrasada',
          hasFinancialImpact: true,
          estimatedAmount: 600,
          linkedGoalId: null,
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.totalEstimatedAmount !== undefined,
      );

      expect(insight?.severity).toBe(InsightSeverity.CRITICAL);
    });
  });

  describe('detectGoalsBlockedByTasks', () => {
    it('flags a goal with two or more overdue linked tasks', async () => {
      const prisma = buildPrisma();
      prisma.goal.findMany.mockResolvedValue([
        { id: 'goal-1', title: 'Viagem para a praia' },
      ]);
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', title: 'Reservar hotel', hasFinancialImpact: false, estimatedAmount: null, linkedGoalId: 'goal-1' },
        { id: 'task-2', title: 'Comprar passagem', hasFinancialImpact: false, estimatedAmount: null, linkedGoalId: 'goal-1' },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.blockedGoals !== undefined,
      );

      expect(insight).toBeDefined();
      expect(insight?.type).toBe(InsightType.GOAL);
      expect(insight?.message).toContain('Viagem para a praia');
      expect((insight?.metadata as any)?.blockedGoals).toHaveLength(1);
    });

    it('does not flag a goal with only one overdue linked task', async () => {
      const prisma = buildPrisma();
      prisma.goal.findMany.mockResolvedValue([
        { id: 'goal-1', title: 'Viagem para a praia' },
      ]);
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', title: 'Reservar hotel', hasFinancialImpact: false, estimatedAmount: null, linkedGoalId: 'goal-1' },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.blockedGoals !== undefined,
        ),
      ).toBeUndefined();
    });

    it('ignores overdue tasks not linked to any goal', async () => {
      const prisma = buildPrisma();
      prisma.goal.findMany.mockResolvedValue([
        { id: 'goal-1', title: 'Viagem para a praia' },
      ]);
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', title: 'Tarefa solta 1', hasFinancialImpact: false, estimatedAmount: null, linkedGoalId: null },
        { id: 'task-2', title: 'Tarefa solta 2', hasFinancialImpact: false, estimatedAmount: null, linkedGoalId: null },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.blockedGoals !== undefined,
        ),
      ).toBeUndefined();
    });
  });

  describe('detectUpcomingBirthday', () => {
    /**
     * Constroi o birthDate do jeito que ele realmente chega em producao:
     * um instante fixo em UTC (meia-noite), como o Postgres/Prisma devolvem
     * pra uma coluna de data. Construir via `new Date(ano, mes, dia)` (fuso
     * local) mascarava o bug de off-by-one que existia antes do fix com
     * getUTCMonth()/getUTCDate() — passava mesmo com a leitura errada,
     * porque escrita e leitura usavam o mesmo fuso.
     */
    const utcDateDaysFromNow = (days: number, yearsAgo = 30) => {
      const now = new Date();
      const future = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
      return new Date(
        Date.UTC(future.getFullYear() - yearsAgo, future.getMonth(), future.getDate()),
      );
    };

    it('flags a birthday happening within the next 7 days', async () => {
      const prisma = buildPrisma([], [], { birthDate: utcDateDaysFromNow(3) });

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find((item) =>
        item.fingerprint.startsWith('ROUTINE:birthday_soon:'),
      );

      expect(insight).toBeDefined();
      expect(insight?.message.toLowerCase()).toContain('aniversario');
      expect((insight?.metadata as any)?.daysUntil).toBe(3);
    });

    it('does not flag a birthday far in the future', async () => {
      const prisma = buildPrisma([], [], { birthDate: utcDateDaysFromNow(60) });

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find((item) =>
          item.fingerprint.startsWith('ROUTINE:birthday_soon:'),
        ),
      ).toBeUndefined();
    });

    it('does nothing when the user has no birthDate declared', async () => {
      const prisma = buildPrisma([], [], { birthDate: null });

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find((item) =>
          item.fingerprint.startsWith('ROUTINE:birthday_soon:'),
        ),
      ).toBeUndefined();
    });
  });

  describe('detectPrimaryGoalWithoutTracking', () => {
    it('flags a declared primary goal with no tracked goal, past the grace period', async () => {
      const prisma = buildPrisma([], [], {
        primaryGoal: 'Sair das dividas',
        createdAt: subDays(new Date(), 10),
      });

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find((item) =>
        item.fingerprint.startsWith('GOAL:primary_goal_untracked:'),
      );

      expect(insight).toBeDefined();
      expect(insight?.message).toContain('Sair das dividas');
    });

    it('does not flag right after signup (grace period)', async () => {
      const prisma = buildPrisma([], [], {
        primaryGoal: 'Sair das dividas',
        createdAt: new Date(),
      });

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find((item) =>
          item.fingerprint.startsWith('GOAL:primary_goal_untracked:'),
        ),
      ).toBeUndefined();
    });

    it('does not flag once the user already has a tracked goal', async () => {
      const prisma = buildPrisma(
        [],
        [],
        { primaryGoal: 'Sair das dividas', createdAt: subDays(new Date(), 10) },
        [
          {
            id: 'goal-1',
            title: 'Quitar cartao',
            targetAmount: 1000,
            currentAmount: 500,
            status: 'ACTIVE',
            targetDate: null,
          },
        ],
      );

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find((item) =>
          item.fingerprint.startsWith('GOAL:primary_goal_untracked:'),
        ),
      ).toBeUndefined();
    });
  });

  describe('detectStalledGoals', () => {
    it('meta com alvo, progresso baixo e prazo proximo: fica sinalizada', async () => {
      const prisma = buildPrisma([], [], {}, [
        {
          id: 'goal-1',
          title: 'Viagem',
          targetAmount: 10000,
          currentAmount: 500,
          status: 'ACTIVE',
          targetDate: addDays(new Date(), 30),
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find((item) => item.fingerprint.startsWith('GOAL:stalled_goals:')),
      ).toBeDefined();
    });

    it('meta SEM alvo, mesmo com prazo proximo, nunca e sinalizada como estagnada', async () => {
      const prisma = buildPrisma([], [], {}, [
        {
          id: 'goal-1',
          title: 'Reserva de emergência',
          targetAmount: null,
          currentAmount: 500,
          status: 'ACTIVE',
          targetDate: addDays(new Date(), 30),
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find((item) => item.fingerprint.startsWith('GOAL:stalled_goals:')),
      ).toBeUndefined();
    });
  });

  describe('detectReceiptComparison', () => {
    const scan = (overrides: Partial<ReceiptScanSeed> & Pick<ReceiptScanSeed, 'id' | 'purchaseDate' | 'totalAmount'>): ReceiptScanSeed => ({
      merchantName: 'Mercado Bom Preco',
      tagGroupId: 'group-compras',
      tagGroup: { name: 'Compras do mes' },
      compareWithPrevious: false,
      items: [],
      ...overrides,
    });

    it('compares the two most recent scans of the same group when the newest opted in', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        scan({
          id: 'r2',
          purchaseDate: now,
          totalAmount: 342,
          compareWithPrevious: true,
          items: [
            { description: 'Arroz 5kg', totalPrice: 32 },
            { description: 'Feijao 1kg', totalPrice: 8 },
          ],
        }),
        scan({
          id: 'r1',
          purchaseDate: subDays(now, 30),
          totalAmount: 305,
          items: [
            { description: 'Arroz 5kg', totalPrice: 25 },
            { description: 'Feijao 1kg', totalPrice: 8 },
          ],
        }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.comparisons !== undefined,
      );

      expect(insight).toBeDefined();
      expect(insight?.type).toBe(InsightType.FINANCE);
      expect(insight?.message).toContain('Compras do mes');
      expect(insight?.message).toContain('Arroz 5kg');

      const comparison = (insight?.metadata as any).comparisons[0];
      expect(comparison.previousTotal).toBe(305);
      expect(comparison.currentTotal).toBe(342);
      expect(comparison.topIncrease.description).toBe('Arroz 5kg');
    });

    it('does nothing when the newest scan of the pair did not opt in to comparison', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        scan({ id: 'r2', purchaseDate: now, totalAmount: 342, compareWithPrevious: false }),
        scan({ id: 'r1', purchaseDate: subDays(now, 30), totalAmount: 305 }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.comparisons !== undefined,
        ),
      ).toBeUndefined();
    });

    it('does nothing on the first scan of a group, with nothing to compare yet', async () => {
      const prisma = buildPrisma([], [
        scan({
          id: 'r1',
          purchaseDate: new Date(),
          totalAmount: 120,
          compareWithPrevious: true,
          items: [{ description: 'Cafe', totalPrice: 20 }],
        }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.comparisons !== undefined,
        ),
      ).toBeUndefined();
    });

    it('does not compare scans from different groups, even from the same merchant', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        scan({
          id: 'r2',
          purchaseDate: now,
          totalAmount: 342,
          compareWithPrevious: true,
          tagGroupId: 'group-padaria',
          tagGroup: { name: 'Padaria' },
        }),
        scan({
          id: 'r1',
          purchaseDate: subDays(now, 30),
          totalAmount: 305,
          tagGroupId: 'group-compras',
          tagGroup: { name: 'Compras do mes' },
        }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.comparisons !== undefined,
        ),
      ).toBeUndefined();
    });

    it('ignores scans without a group, since the group is what makes them comparable', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        { ...scan({ id: 'r2', purchaseDate: now, totalAmount: 500, compareWithPrevious: true }), tagGroupId: null as any },
        { ...scan({ id: 'r1', purchaseDate: subDays(now, 10), totalAmount: 50 }), tagGroupId: null as any },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.comparisons !== undefined,
        ),
      ).toBeUndefined();
    });

    it('escalates to critical when the total jumps 40% or more', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        scan({ id: 'r2', purchaseDate: now, totalAmount: 420, compareWithPrevious: true }),
        scan({ id: 'r1', purchaseDate: subDays(now, 30), totalAmount: 300 }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.comparisons !== undefined,
      );

      expect(insight?.severity).toBe(InsightSeverity.CRITICAL);
    });

    it('points out an item that got cheaper as an improvement', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        scan({
          id: 'r2',
          purchaseDate: now,
          totalAmount: 100,
          compareWithPrevious: true,
          items: [{ description: 'Oleo', totalPrice: 8 }],
        }),
        scan({
          id: 'r1',
          purchaseDate: subDays(now, 30),
          totalAmount: 100,
          items: [{ description: 'Oleo', totalPrice: 12 }],
        }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.comparisons !== undefined,
      );

      expect(insight?.message).toContain('melhorou');
      expect((insight?.metadata as any).comparisons[0].topDecrease.description).toBe('Oleo');
    });

    it('names both merchants in the message when the group spans different stores', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        scan({
          id: 'r2',
          purchaseDate: now,
          totalAmount: 342,
          compareWithPrevious: true,
          merchantName: 'Padaria Central',
        }),
        scan({
          id: 'r1',
          purchaseDate: subDays(now, 30),
          totalAmount: 305,
          merchantName: 'Padaria Sao Jose',
        }),
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.comparisons !== undefined,
      );

      expect(insight?.message).toContain('Padaria Central');
      expect(insight?.message).toContain('Padaria Sao Jose');
    });
  });

  describe('persona', () => {
    it('stamps the persona of the type on every generated insight', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 10) },
        { id: 't2', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 9) },
      ]);
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', title: 'Atrasada', status: 'PENDING' },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insights = generatedInsights(prisma);

      expect(insights.length).toBeGreaterThan(1);
      expect(
        insights.every((insight) => (insight.metadata as any)?.persona?.name),
      ).toBe(true);

      const byType = (type: InsightType) =>
        (insights.find((insight) => insight.type === type)?.metadata as any)?.persona?.name;

      expect(byType(InsightType.PRODUCTIVITY)).toBe('Norte');
      expect(byType(InsightType.FINANCE)).toBe('Lastro');
    });

    it('keeps the detector metadata alongside the persona', async () => {
      const now = new Date();
      const prisma = buildPrisma([
        { id: 't1', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 10) },
        { id: 't2', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 9) },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const duplicate = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.duplicates !== undefined,
      );

      expect((duplicate?.metadata as any)?.persona?.name).toBe('Lastro');
      expect((duplicate?.metadata as any)?.duplicates).toHaveLength(1);
    });

    it('stamps the persona on the fallback insight too', async () => {
      const prisma = buildPrisma();

      await new InsightsService(prisma).refreshForUser('user-1');

      const insights = generatedInsights(prisma);

      expect(insights).toHaveLength(1);
      expect((insights[0].metadata as any)?.persona?.name).toBe('Compasso');
    });
  });

  describe('fingerprint', () => {
    it('keeps the same fingerprint while the situation does not change', async () => {
      const expenses = [
        { id: 't1', description: 'Streaming Plus', amount: 39.9, date: subDays(new Date(), 10) },
        { id: 't2', description: 'Streaming Plus', amount: 39.9, date: subDays(new Date(), 9) },
      ];

      const first = buildPrisma(expenses);
      await new InsightsService(first).refreshForUser('user-1');

      const second = buildPrisma(expenses);
      await new InsightsService(second).refreshForUser('user-1');

      expect(generatedInsights(first).map((insight) => insight.fingerprint)).toEqual(
        generatedInsights(second).map((insight) => insight.fingerprint),
      );
    });

    it('changes the fingerprint when a different charge is duplicated', async () => {
      const now = new Date();
      const first = buildPrisma([
        { id: 't1', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 10) },
        { id: 't2', description: 'Streaming Plus', amount: 39.9, date: subDays(now, 9) },
      ]);
      await new InsightsService(first).refreshForUser('user-1');

      const second = buildPrisma([
        { id: 't3', description: 'Livraria', amount: 55, date: subDays(now, 4) },
        { id: 't4', description: 'Livraria', amount: 55, date: subDays(now, 3) },
      ]);
      await new InsightsService(second).refreshForUser('user-1');

      const fingerprintOfDuplicate = (prisma: any) =>
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.duplicates !== undefined,
        )?.fingerprint;

      expect(fingerprintOfDuplicate(first)).toBeDefined();
      expect(fingerprintOfDuplicate(second)).toBeDefined();
      expect(fingerprintOfDuplicate(first)).not.toBe(fingerprintOfDuplicate(second));
    });

    it('changes the fingerprint when the alert escalates in severity', async () => {
      const warning = buildPrisma();
      warning.task.findMany.mockResolvedValue([{ id: 'a', title: 'Uma' }]);
      await new InsightsService(warning).refreshForUser('user-1');

      const critical = buildPrisma();
      critical.task.findMany.mockResolvedValue([
        { id: 'a', title: 'Uma' },
        { id: 'b', title: 'Duas' },
        { id: 'c', title: 'Tres' },
      ]);
      await new InsightsService(critical).refreshForUser('user-1');

      const overdueFingerprint = (prisma: any) =>
        generatedInsights(prisma).find(
          (insight) => insight.type === InsightType.PRODUCTIVITY,
        )?.fingerprint;

      expect(overdueFingerprint(warning)).toContain('WARNING');
      expect(overdueFingerprint(critical)).toContain('CRITICAL');
      expect(overdueFingerprint(warning)).not.toBe(overdueFingerprint(critical));
    });

    it('prunes fingerprints that are no longer generated', async () => {
      const prisma = buildPrisma();

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(prisma.insight.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            fingerprint: { notIn: expect.arrayContaining([expect.any(String)]) },
          }),
        }),
      );
    });

    it('preserves notifiedAt on update, so a running alert is not re-notified', async () => {
      const prisma = buildPrisma();

      await new InsightsService(prisma).refreshForUser('user-1');

      const updatePayload = prisma.insight.upsert.mock.calls[0][0].update;

      expect(updatePayload).not.toHaveProperty('notifiedAt');
    });
  });

  describe('takePendingNotifications', () => {
    it('returns only un-notified critical insights and marks them as notified', async () => {
      const prisma = buildPrisma();
      prisma.insight.findMany.mockResolvedValueOnce([
        { id: 'i1', severity: InsightSeverity.CRITICAL, message: 'Alerta' },
      ]);

      const pending = await new InsightsService(prisma).takePendingNotifications('user-1');

      expect(prisma.insight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            notifiedAt: null,
            severity: { in: [InsightSeverity.CRITICAL] },
          }),
        }),
      );
      expect(pending).toHaveLength(1);
      expect(prisma.insight.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['i1'] } },
          data: { notifiedAt: expect.any(Date) },
        }),
      );
    });

    it('does not touch the database when nothing is pending', async () => {
      const prisma = buildPrisma();
      prisma.insight.findMany.mockResolvedValueOnce([]);

      const pending = await new InsightsService(prisma).takePendingNotifications('user-1');

      expect(pending).toEqual([]);
      expect(prisma.insight.updateMany).not.toHaveBeenCalled();
    });
  });

  it('scopes the expense window query to the user', async () => {
    const prisma = buildPrisma();

    await new InsightsService(prisma).refreshForUser('user-1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', type: 'EXPENSE' }),
      }),
    );
  });

  describe('detectCategoryShift', () => {
    const categories = [
      { id: 'cat-food', name: 'Alimentacao' },
      { id: 'cat-leisure', name: 'Lazer' },
      { id: 'cat-bills', name: 'Contas' },
    ];
    const run = async (current: CategoryGroupSeed[], previous: CategoryGroupSeed[]) => {
      const prisma = buildPrisma([], [], {}, [], { current, previous, categories });
      await new InsightsService(prisma).refreshForUser('user-1');
      return generatedInsights(prisma).filter((insight) =>
        insight.fingerprint.includes('category_shift'),
      );
    };

    it('flags the category that gained the most share vs the previous month', async () => {
      // Alimentacao: 30% -> 60%. Lazer: 20% -> 20%. Contas: 50% -> 20%.
      const insights = await run(
        [group('cat-food', 600), group('cat-leisure', 200), group('cat-bills', 200)],
        [group('cat-food', 300), group('cat-leisure', 200), group('cat-bills', 500)],
      );

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe(InsightType.FINANCE);
      expect(insights[0].severity).toBe(InsightSeverity.WARNING);
      expect(insights[0].message).toContain('Alimentacao ja pesa 60%');
      expect(insights[0].message).toContain('contra 30%');
      expect(insights[0].metadata).toEqual(
        expect.objectContaining({ category: 'Alimentacao', sharePct: 60, previousSharePct: 30 }),
      );
    });

    it('is informational (not a warning) for a moderate jump', async () => {
      // Lazer 25% -> 38% (+13 pontos).
      const insights = await run(
        [group('cat-leisure', 380), group('cat-food', 620)],
        [group('cat-leisure', 250), group('cat-food', 750)],
      );

      expect(insights).toHaveLength(1);
      expect(insights[0].severity).toBe(InsightSeverity.INFO);
      expect(insights[0].message).toContain('Lazer ja pesa 38%');
    });

    it('stays quiet when nothing changed enough', async () => {
      const insights = await run(
        [group('cat-food', 500), group('cat-leisure', 500)],
        [group('cat-food', 480), group('cat-leisure', 520)],
      );

      expect(insights).toHaveLength(0);
    });

    it('needs enough spending and enough transactions before comparing', async () => {
      const tiny = await run(
        [group('cat-food', 90, 6), group('cat-leisure', 10, 6)],
        [group('cat-food', 10), group('cat-leisure', 90)],
      );
      const fewTransactions = await run(
        [group('cat-food', 900, 2), group('cat-leisure', 100, 2)],
        [group('cat-food', 100), group('cat-leisure', 900)],
      );

      expect(tiny).toHaveLength(0);
      expect(fewTransactions).toHaveLength(0);
    });

    it('does not compare against a month with no spending', async () => {
      const insights = await run([group('cat-food', 800), group('cat-leisure', 200)], []);

      expect(insights).toHaveLength(0);
    });

    it('never points at uncategorized spending', async () => {
      const insights = await run(
        [group(null, 800), group('cat-food', 200)],
        [group(null, 200), group('cat-food', 800)],
      );

      expect(insights).toHaveLength(0);
    });

    it('names the previous month and queries UTC month boundaries', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
      try {
        const prisma = buildPrisma([], [], {}, [], {
          current: [group('cat-food', 600), group('cat-leisure', 400)],
          previous: [group('cat-food', 300), group('cat-leisure', 700)],
          categories,
        });
        await new InsightsService(prisma).refreshForUser('user-1');
        const insight = generatedInsights(prisma).find((item) =>
          item.fingerprint.includes('category_shift'),
        );

        expect(insight?.message).toContain('em agosto');
        const [currentCall, previousCall] = prisma.transaction.groupBy.mock.calls;
        expect(currentCall[0].where.date.gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
        expect(previousCall[0].where.date.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
        expect(previousCall[0].where.date.lte.toISOString()).toBe('2026-08-31T23:59:59.999Z');
      } finally {
        jest.useRealTimers();
      }
    });

    it('treats a category absent last month as starting from 0%', async () => {
      const insights = await run(
        [group('cat-leisure', 400), group('cat-food', 600)],
        [group('cat-food', 1000)],
      );

      expect(insights).toHaveLength(1);
      expect(insights[0].message).toContain('Lazer ja pesa 40%');
      expect(insights[0].message).toContain('contra 0%');
    });
  });

  describe('detectCategoryBudgets', () => {
    type Cat = { id: string; name: string; monthlyBudget?: number | null };
    const food: Cat = { id: 'cat-food', name: 'Alimentacao', monthlyBudget: 1000 };
    const leisure: Cat = { id: 'cat-leisure', name: 'Lazer', monthlyBudget: 500 };

    const run = async (current: CategoryGroupSeed[], categories: Cat[]) => {
      const prisma = buildPrisma([], [], {}, [], { current, previous: [], categories });
      await new InsightsService(prisma).refreshForUser('user-1');
      return generatedInsights(prisma).filter((insight) =>
        insight.fingerprint.includes(':budget:'),
      );
    };

    it('stays quiet when no category has a budget', async () => {
      const insights = await run([group('cat-food', 5000)], [
        { id: 'cat-food', name: 'Alimentacao', monthlyBudget: null },
      ]);

      expect(insights).toHaveLength(0);
    });

    it('stays quiet while spending is below 80% of the budget', async () => {
      const insights = await run([group('cat-food', 790)], [food]);

      expect(insights).toHaveLength(0);
    });

    it('warns at 80% or more, with what is left', async () => {
      const insights = await run([group('cat-food', 840)], [food]);

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe(InsightType.FINANCE);
      expect(insights[0].severity).toBe(InsightSeverity.WARNING);
      expect(insights[0].message).toContain('Alimentacao ja usou 84%');
      expect(insights[0].message).toContain('Faltam');
      expect(insights[0].metadata).toEqual(
        expect.objectContaining({ category: 'Alimentacao', budget: 1000, spent: 840, usedPct: 84 }),
      );
    });

    it('is critical once the budget is exceeded', async () => {
      const insights = await run([group('cat-food', 1120)], [food]);

      expect(insights).toHaveLength(1);
      expect(insights[0].severity).toBe(InsightSeverity.CRITICAL);
      expect(insights[0].message).toContain('Alimentacao passou do orcamento');
      expect(insights[0].message).toContain('112%');
    });

    it('treats exactly 100% as exceeded', async () => {
      const insights = await run([group('cat-food', 1000)], [food]);

      expect(insights[0].severity).toBe(InsightSeverity.CRITICAL);
    });

    it('changes identity when a warning escalates to critical (so it notifies again)', async () => {
      const [warning] = await run([group('cat-food', 850)], [food]);
      const [critical] = await run([group('cat-food', 1100)], [food]);

      expect(warning.fingerprint).not.toEqual(critical.fingerprint);
    });

    it('ignores a budgeted category with no spending this month', async () => {
      const insights = await run([group('cat-leisure', 400)], [food, leisure]);

      // Lazer 80% avisa; Alimentacao (sem gasto) nao.
      expect(insights).toHaveLength(1);
      expect(insights[0].message).toContain('Lazer');
    });

    it('alerts at most the 3 heaviest categories, heaviest first', async () => {
      const cats: Cat[] = ['a', 'b', 'c', 'd'].map((id) => ({
        id: `cat-${id}`,
        name: `Cat ${id.toUpperCase()}`,
        monthlyBudget: 100,
      }));
      const insights = await run(
        [group('cat-a', 90), group('cat-b', 150), group('cat-c', 120), group('cat-d', 100)],
        cats,
      );

      expect(insights).toHaveLength(3);
      expect(insights.map((insight) => insight.metadata?.category)).toEqual([
        'Cat B',
        'Cat C',
        'Cat D',
      ]);
    });
  });

  describe('detectUpcomingBills', () => {
    const daysFromToday = (days: number) => {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
    };
    const bill = (id: string, description: string, amount: number, days: number) => ({
      id,
      description,
      amount,
      nextDueDate: daysFromToday(days),
    });

    const run = async (bills: unknown[]) => {
      const prisma = buildPrisma([], [], {}, [], undefined, bills);
      await new InsightsService(prisma).refreshForUser('user-1');
      return {
        prisma,
        insights: generatedInsights(prisma).filter((insight) =>
          insight.fingerprint.includes(':upcoming_bills:'),
        ),
      };
    };

    it('stays quiet without bills', async () => {
      const { insights } = await run([]);

      expect(insights).toHaveLength(0);
    });

    it('is informational for a bill due in a few days', async () => {
      const { insights } = await run([bill('r1', 'Aluguel', 1200, 3)]);

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe(InsightType.FINANCE);
      expect(insights[0].severity).toBe(InsightSeverity.INFO);
      expect(insights[0].message).toContain('Aluguel');
      expect(insights[0].message).toContain('vence em 3 dias');
    });

    it('warns when the bill is due tomorrow', async () => {
      const { insights } = await run([bill('r1', 'Internet', 100, 1)]);

      expect(insights[0].severity).toBe(InsightSeverity.WARNING);
      expect(insights[0].message).toContain('vence amanha');
    });

    it('groups several bills in one insight, nearest first, with the total', async () => {
      const { insights } = await run([
        bill('r2', 'Internet', 100, 2),
        bill('r1', 'Aluguel', 1200, 1),
      ].sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime()));

      expect(insights).toHaveLength(1);
      expect(insights[0].message).toContain('2 contas fixas');
      expect(insights[0].message).toMatch(/1\.300,00/);
      expect(insights[0].message.indexOf('Aluguel')).toBeLessThan(insights[0].message.indexOf('Internet'));
      expect(insights[0].severity).toBe(InsightSeverity.WARNING);
      expect(insights[0].metadata).toEqual(
        expect.objectContaining({ count: 2, total: 1300, nearestDays: 1 }),
      );
    });

    it('lists at most 3 bills and counts the rest', async () => {
      const { insights } = await run([
        bill('r1', 'A', 10, 1),
        bill('r2', 'B', 10, 2),
        bill('r3', 'C', 10, 2),
        bill('r4', 'D', 10, 3),
      ]);

      expect(insights[0].message).toContain('4 contas fixas');
      expect(insights[0].message).toContain('e mais 1');
      expect(insights[0].message).not.toContain('D (');
    });

    it('ignores bills due today (already posted) and beyond the window', async () => {
      const { insights } = await run([
        bill('r1', 'Hoje', 10, 0),
        bill('r2', 'Longe', 10, 4),
        bill('r3', 'Passada', 10, -1),
      ]);

      expect(insights).toHaveLength(0);
    });

    it('changes identity when the set of upcoming bills changes (so it notifies again)', async () => {
      const first = await run([bill('r1', 'Aluguel', 1200, 2)]);
      const second = await run([bill('r1', 'Aluguel', 1200, 2), bill('r2', 'Internet', 100, 2)]);

      expect(first.insights[0].fingerprint).not.toEqual(second.insights[0].fingerprint);
    });

    it('keeps bills generated from a template out of the recurring/duplicate charge detectors', async () => {
      const { prisma } = await run([]);

      const chargeQuery = prisma.transaction.findMany.mock.calls[0][0];
      expect(chargeQuery.where.recurringTransactionId).toBeNull();
    });
  });

  describe('detectCreditCycle', () => {
    const run = async (options: {
      ceiling?: number | null;
      spent?: number | null;
      dueDay?: number | null;
      monthClosingDay?: number;
    } = {}) => {
      const prisma = buildPrisma([], [], {
        monthClosingDay: options.monthClosingDay ?? 30,
        creditDueDay: options.dueDay ?? null,
      });
      if (options.ceiling !== undefined && options.ceiling !== null) {
        prisma.creditCycleCeiling.findUnique.mockResolvedValue({ ceiling: options.ceiling });
      }
      prisma.transaction.aggregate = jest.fn().mockResolvedValue({
        _sum: { amount: options.spent ?? null },
      });

      await new InsightsService(prisma).refreshForUser('user-1');

      return generatedInsights(prisma).filter((insight) =>
        insight.fingerprint.includes(':credit_cycle:'),
      );
    };

    it('sem teto definido, fica em silencio', async () => {
      const insights = await run({ ceiling: null, spent: 5000 });

      expect(insights).toHaveLength(0);
    });

    it('abaixo de 80%, fica em silencio', async () => {
      const insights = await run({ ceiling: 1000, spent: 700 });

      expect(insights).toHaveLength(0);
    });

    it('80% ou mais vira WARNING, com o quanto falta', async () => {
      const insights = await run({ ceiling: 1000, spent: 840 });

      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe(InsightType.FINANCE);
      expect(insights[0].severity).toBe(InsightSeverity.WARNING);
      expect(insights[0].message).toContain('ja usou 84%');
      expect(insights[0].message).toContain('Faltam');
    });

    it('100% ou mais vira CRITICAL', async () => {
      const insights = await run({ ceiling: 1000, spent: 1120 });

      expect(insights[0].severity).toBe(InsightSeverity.CRITICAL);
      expect(insights[0].message).toContain('passou do teto');
      expect(insights[0].message).toContain('112%');
    });

    it('menciona o vencimento quando definido, e omite quando nao ha', async () => {
      const withDueDay = await run({ ceiling: 1000, spent: 900, dueDay: 15 });
      expect(withDueDay[0].message).toContain('vence dia 15');

      const withoutDueDay = await run({ ceiling: 1000, spent: 900, dueDay: null });
      expect(withoutDueDay[0].message).not.toContain('vence');
    });

    it('muda de identidade quando escala de aviso para critico (reavisa)', async () => {
      const [warning] = await run({ ceiling: 1000, spent: 850 });
      const [critical] = await run({ ceiling: 1000, spent: 1100 });

      expect(warning.fingerprint).not.toEqual(critical.fingerprint);
    });
  });
});

describe('InsightsService: gasto do ciclo pelo cartao padrao (contrato item 9, secao 4.8)', () => {
  // Todas as wheres de agregado feitas pelo servico (o insights tem mais de um agregado de mes).
  const wheres = (prisma: any): any[] =>
    prisma.transaction.aggregate.mock.calls.map(([args]: any) => args.where);

  it('cartao padrao sem countAllPayments: o ciclo filtra CREDIT do proprio cartao ou sem cartao', async () => {
    const prisma: any = buildPrisma([], [], { creditCycleCountAllPayments: false });
    prisma.creditCard.findFirst.mockResolvedValue({ id: 'card-default', isDefault: true, countAllPayments: false });
    await new InsightsService(prisma).refreshForUser('user-1');
    expect(wheres(prisma)).toContainEqual(
      expect.objectContaining({
        paymentMethod: 'CREDIT',
        OR: [{ cardId: 'card-default' }, { cardId: null, paymentMethod: 'CREDIT' }],
      }),
    );
  });

  it('cartao padrao com countAllPayments: nenhum agregado do ciclo filtra por forma ou cartao', async () => {
    const prisma: any = buildPrisma([], [], { creditCycleCountAllPayments: true });
    prisma.creditCard.findFirst.mockResolvedValue({ id: 'card-default', isDefault: true, countAllPayments: true });
    await new InsightsService(prisma).refreshForUser('user-1');
    expect(wheres(prisma).some((where) => where.OR !== undefined || where.paymentMethod === 'CREDIT')).toBe(false);
  });

  it('sem cartao padrao ativo nao ha filtro de ciclo de cartao (gasto zero)', async () => {
    const prisma: any = buildPrisma([], [], {});
    prisma.creditCard.findFirst.mockResolvedValue(null);
    await new InsightsService(prisma).refreshForUser('user-1');
    expect(wheres(prisma).some((where) => where.OR !== undefined || where.paymentMethod === 'CREDIT')).toBe(false);
  });
});

describe('InsightsService: busca do cartao padrao', () => {
  it('procura so o padrao ativo do proprio usuario', async () => {
    const prisma: any = buildPrisma([], [], {});
    await new InsightsService(prisma).refreshForUser('user-1');
    expect(prisma.creditCard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isDefault: true, archivedAt: null } }),
    );
  });
});

describe('InsightsService: ciclo pelo dia de fechamento do cartao padrao', () => {
  it('usa o closingDay do cartao padrao, nao o espelho do User', async () => {
    const prisma: any = buildPrisma([], [], { monthClosingDay: 30, creditCycleCountAllPayments: false });
    prisma.creditCard.findFirst.mockResolvedValue({ id: 'card-default', isDefault: true, countAllPayments: false, closingDay: 5 });
    await new InsightsService(prisma).refreshForUser('user-1');
    const expectedStart = creditCycleBounds(localToday(new Date(), 'UTC'), 5).start;
    const wheres = prisma.transaction.aggregate.mock.calls.map(([args]: any) => args.where);
    expect(wheres).toContainEqual(expect.objectContaining({ date: { gte: expectedStart, lte: expect.any(Date) } }));
  });
});
