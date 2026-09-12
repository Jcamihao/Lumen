import { InsightSeverity, InsightType } from '@prisma/client';
import { subDays } from 'date-fns';
import { InsightsService } from './insights.service';

type ExpenseSeed = {
  id: string;
  description: string;
  amount: number;
  date: Date;
};

const buildPrisma = (expenses: ExpenseSeed[] = []) => {
  const prisma = {
    insight: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue({}),
      createMany: jest.fn().mockReturnValue({}),
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
  } as any;

  return prisma;
};

/** Le os insights que o service mandou persistir, sem depender do retorno do banco. */
const generatedInsights = (prisma: any) =>
  prisma.insight.createMany.mock.calls[0][0].data as Array<{
    type: InsightType;
    severity: InsightSeverity;
    message: string;
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
