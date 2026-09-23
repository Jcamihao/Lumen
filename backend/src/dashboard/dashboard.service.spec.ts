import { DashboardService } from './dashboard.service';

const buildService = (
  options: {
    firsts?: Partial<Record<'task' | 'transaction' | 'goal' | 'recurring' | 'assistant', boolean>>;
    cached?: unknown;
  } = {},
) => {
  const has = (key: keyof NonNullable<typeof options.firsts>) =>
    options.firsts?.[key] ? { id: `${key}-1` } : null;

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'user-1',
        name: 'Marina',
        preferredCurrency: 'BRL',
        monthlyIncome: 0,
      }),
    },
    task: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(has('task')),
    },
    transaction: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      findFirst: jest.fn().mockResolvedValue(has('transaction')),
    },
    goal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(has('goal')),
    },
    reminder: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    recurringTransaction: { findFirst: jest.fn().mockResolvedValue(has('recurring')) },
    assistantTurn: { findFirst: jest.fn().mockResolvedValue(has('assistant')) },
  };
  const cache = {
    getJson: jest.fn().mockResolvedValue(options.cached ?? null),
    setJson: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const insights = { list: jest.fn().mockResolvedValue([]) };
  const forecasts = {
    getCurrent: jest.fn().mockResolvedValue({ id: 'f1', predictedBalance: 0, riskLevel: 'LOW' }),
  };
  const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
  const installmentMaterializer = { materializeDue: jest.fn().mockResolvedValue(0) };

  const service = new DashboardService(
    prisma as any,
    cache as any,
    insights as any,
    forecasts as any,
    materializer as any,
    installmentMaterializer as any,
  );

  return { service, prisma, cache };
};

describe('DashboardService — onboarding', () => {
  it('conta nova: nenhum passo concluido', async () => {
    const { service } = buildService();

    const summary: any = await service.getSummary('user-1');

    expect(summary.onboarding).toEqual({
      tasks: false,
      transactions: false,
      goals: false,
      recurring: false,
      selah: false,
    });
  });

  it('marca cada passo so quando existe o item correspondente', async () => {
    const { service } = buildService({ firsts: { task: true, goal: true, assistant: true } });

    const summary: any = await service.getSummary('user-1');

    expect(summary.onboarding).toEqual({
      tasks: true,
      transactions: false,
      goals: true,
      recurring: false,
      selah: true,
    });
  });

  it('lancamento gerado por conta fixa nao conta como "registrei um gasto"', async () => {
    const { service, prisma } = buildService();

    await service.getSummary('user-1');

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', recurringTransactionId: null } }),
    );
  });

  it('as consultas sao sempre do proprio usuario', async () => {
    const { service, prisma } = buildService();

    await service.getSummary('user-1');

    for (const call of [
      prisma.task.findFirst,
      prisma.goal.findFirst,
      prisma.recurringTransaction.findFirst,
      prisma.assistantTurn.findFirst,
    ]) {
      expect(call.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    }
  });

  it('guarda no cache e devolve o cache sem refazer as consultas', async () => {
    const first = buildService();
    await first.service.getSummary('user-1');
    expect(first.cache.setJson).toHaveBeenCalledTimes(1);

    const cached = buildService({ cached: { fromCache: true } });
    const summary = await cached.service.getSummary('user-1');
    expect(summary).toEqual({ fromCache: true });
    expect(cached.prisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('invalidateSummary apaga so o cache do usuario', async () => {
    const { service, cache } = buildService();

    await service.invalidateSummary('user-1');

    expect(cache.del).toHaveBeenCalledWith('dashboard:summary:user-1');
  });
});
