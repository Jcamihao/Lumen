import { InsightSeverity, InsightType } from '@prisma/client';
import { subDays } from 'date-fns';
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
};

const buildPrisma = (expenses: ExpenseSeed[] = [], receiptScans: ReceiptScanSeed[] = []) => {
  const prisma = {
    insight: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn((args: any) => args),
    },
    $transaction: jest.fn().mockResolvedValue([]),
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'user-1',
        monthlyIncome: 5000,
        preferredCurrency: 'BRL',
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
    },
    goal: {
      findMany: jest.fn().mockResolvedValue([]),
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

  describe('detectReceiptComparison', () => {
    it('compares the two most recent scans from the same merchant', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        {
          id: 'r2',
          merchantName: 'Mercado Bom Preco',
          purchaseDate: now,
          totalAmount: 342,
          items: [
            { description: 'Arroz 5kg', totalPrice: 32 },
            { description: 'Feijao 1kg', totalPrice: 8 },
          ],
        },
        {
          id: 'r1',
          merchantName: 'Mercado Bom Preco',
          purchaseDate: subDays(now, 30),
          totalAmount: 305,
          items: [
            { description: 'Arroz 5kg', totalPrice: 25 },
            { description: 'Feijao 1kg', totalPrice: 8 },
          ],
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.comparisons !== undefined,
      );

      expect(insight).toBeDefined();
      expect(insight?.type).toBe(InsightType.FINANCE);
      expect(insight?.message).toContain('Mercado Bom Preco');
      expect(insight?.message).toContain('Arroz 5kg');

      const comparison = (insight?.metadata as any).comparisons[0];
      expect(comparison.previousTotal).toBe(305);
      expect(comparison.currentTotal).toBe(342);
      expect(comparison.topIncrease.description).toBe('Arroz 5kg');
    });

    it('does nothing on the first scan of a merchant, with nothing to compare yet', async () => {
      const prisma = buildPrisma([], [
        {
          id: 'r1',
          merchantName: 'Mercado Novo',
          purchaseDate: new Date(),
          totalAmount: 120,
          items: [{ description: 'Cafe', totalPrice: 20 }],
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      expect(
        generatedInsights(prisma).find(
          (insight) => (insight.metadata as any)?.comparisons !== undefined,
        ),
      ).toBeUndefined();
    });

    it('ignores receipts without a recognized merchant name, to avoid comparing different stores', async () => {
      const now = new Date();
      const prisma = buildPrisma([], [
        {
          id: 'r2',
          merchantName: 'Compra registrada',
          purchaseDate: now,
          totalAmount: 500,
          items: [],
        },
        {
          id: 'r1',
          merchantName: 'Compra registrada',
          purchaseDate: subDays(now, 10),
          totalAmount: 50,
          items: [],
        },
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
        {
          id: 'r2',
          merchantName: 'Mercado Bom Preco',
          purchaseDate: now,
          totalAmount: 420,
          items: [],
        },
        {
          id: 'r1',
          merchantName: 'Mercado Bom Preco',
          purchaseDate: subDays(now, 30),
          totalAmount: 300,
          items: [],
        },
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
        {
          id: 'r2',
          merchantName: 'Mercado Bom Preco',
          purchaseDate: now,
          totalAmount: 100,
          items: [{ description: 'Oleo', totalPrice: 8 }],
        },
        {
          id: 'r1',
          merchantName: 'Mercado Bom Preco',
          purchaseDate: subDays(now, 30),
          totalAmount: 100,
          items: [{ description: 'Oleo', totalPrice: 12 }],
        },
      ]);

      await new InsightsService(prisma).refreshForUser('user-1');

      const insight = generatedInsights(prisma).find(
        (insight) => (insight.metadata as any)?.comparisons !== undefined,
      );

      expect(insight?.message).toContain('melhorou');
      expect((insight?.metadata as any).comparisons[0].topDecrease.description).toBe('Oleo');
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
});
