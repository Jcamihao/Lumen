import { InsightSeverity, InsightType } from '@prisma/client';
import { InsightsService } from './insights.service';

describe('InsightsService', () => {
  it('returns a calm insight when no risks are present', async () => {
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
        }),
      },
      task: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      },
      transaction: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            amount: 1200,
          },
        }),
      },
      goal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      reminder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

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
});
