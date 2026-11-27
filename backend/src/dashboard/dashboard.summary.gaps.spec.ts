import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-12-01T01:00:00.000Z');
const none = jest.fn(async () => []);
const dec = (value: string) => ({ valueOf: () => Number(value), toString: () => value });

const build = (over: { profile?: object; tasks?: object[]; found?: Record<string, unknown> } = {}) => {
  const found = { task: null, transaction: null, goal: null, recurringTransaction: null, assistantTurn: null, ...over.found };
  const first = (name: keyof typeof found) => ({ findFirst: jest.fn(async () => found[name]) });
  const profile = { id: 'u', name: 'N', preferredCurrency: 'BRL', monthlyIncome: dec('1'), ...over.profile };
  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async ({ select }: any) => (select.timezone ? { timezone: 'America/Sao_Paulo' } : profile)) },
    task: { count: jest.fn(async () => 0), findMany: jest.fn(async () => over.tasks ?? []), ...first('task') },
    transaction: {
      groupBy: jest.fn(async () => [{ type: 'INCOME', _sum: { amount: undefined } }]),
      findMany: none,
      aggregate: jest.fn(async () => ({ _sum: { amount: undefined } })),
      ...first('transaction'),
    },
    goal: { findMany: none, ...first('goal') },
    reminder: { findMany: jest.fn(async () => []) },
    notification: { findMany: none },
    recurringTransaction: first('recurringTransaction'),
    assistantTurn: first('assistantTurn'),
  };
  const cache = { getJson: jest.fn(async () => null), setJson: jest.fn(), del: jest.fn() };
  const zero = { materializeDue: jest.fn(async () => 0) };
  const service = new DashboardService(prisma as any, cache as any, { list: none } as any, { getCurrent: none } as any, zero as any, zero as any);
  return { service, prisma };
};

describe('DashboardService — lacunas de caracterizacao', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('janela do mes usa o fuso do usuario (30/11 em Sao Paulo, nao 01/12 UTC)', async () => {
    const { service, prisma } = build();
    await service.getSummary('u');
    const date = { gte: new Date('2026-11-01T00:00:00.000Z'), lt: new Date('2026-12-01T00:00:00.000Z') };
    expect(prisma.transaction.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ date }) }));
  });

  it('chaves do resumo na ordem original', async () => {
    const { service } = build();
    const summary = await service.getSummary('u');
    expect(Object.keys(summary)).toEqual(['user', 'tasks', 'finances', 'goals', 'reminders', 'insights', 'forecast', 'notifications', 'onboarding']);
    expect(Object.keys(summary.onboarding)).toEqual(['tasks', 'transactions', 'goals', 'recurring', 'selah']);
  });

  it.each(['task', 'transaction', 'goal', 'recurringTransaction', 'assistantTurn'])('onboarding: so %s existente liga so o seu item', async (name) => {
    const { service } = build({ found: { [name]: { id: 'x' } } });
    const { onboarding } = await service.getSummary('u');
    expect(Object.values(onboarding).filter(Boolean)).toHaveLength(1);
    const key = { task: 'tasks', transaction: 'transactions', goal: 'goals', recurringTransaction: 'recurring', assistantTurn: 'selah' }[name]!;
    expect(onboarding[key as keyof typeof onboarding]).toBe(true);
  });

  it('valores ausentes: undefined vira 0 (renda, saldo, mes) e null (estimativa da tarefa)', async () => {
    const { service } = build({ profile: { monthlyIncome: undefined }, tasks: [{ id: 't', estimatedAmount: undefined }] });
    const summary = await service.getSummary('u');
    expect(summary.user.monthlyIncome).toBe(0);
    expect(summary.finances).toMatchObject({ balance: 0, monthlyExpenses: 0, monthlyIncome: 0 });
    expect(summary.tasks.items[0].estimatedAmount).toBeNull();
  });

  it('selects completos de transacoes, metas; ordem dos lembretes', async () => {
    const { service, prisma } = build();
    await service.getSummary('u');
    const tx = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].select;
    expect(tx).toEqual({ id: true, description: true, type: true, amount: true, date: true, category: true });
    expect(prisma.goal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, title: true, description: true, targetAmount: true, currentAmount: true, targetDate: true, status: true },
    }));
    expect(prisma.reminder.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { remindAt: 'asc' } }));
  });
});
