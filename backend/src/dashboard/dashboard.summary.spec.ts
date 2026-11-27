import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-11-15T16:00:00.000Z');
const OPEN = ['PENDING', 'IN_PROGRESS'];
const decimal = (value: string) => ({ valueOf: () => Number(value), toString: () => value });
const at = (h: number, m: number, s: number, ms: number) => {
  const day = new Date(NOW);
  day.setHours(h, m, s, ms);
  return day;
};
const profile = { id: 'user-1', name: 'Marina', preferredCurrency: 'BRL', monthlyIncome: decimal('5000'), birthDate: null, occupation: null, primaryGoal: 'SAVE' };
const todayTasks = [
  { id: 't1', title: 'Pagar boleto', priority: 'HIGH', dueDate: NOW, status: 'PENDING', estimatedAmount: decimal('250.75'), category: { id: 'c1' } },
  { id: 't2', title: 'Ligar', priority: 'LOW', dueDate: NOW, status: 'IN_PROGRESS', estimatedAmount: null, category: null },
];
const transactions = [
  { id: 'tx1', description: 'Mercado', type: 'EXPENSE', amount: decimal('320.25'), date: NOW, category: 'Comida' },
  { id: 'tx2', description: 'Salario', type: 'INCOME', amount: decimal('1500.5'), date: NOW, category: 'Renda' },
];
const goals = [
  { id: 'g1', title: 'Reserva', targetAmount: decimal('10000'), currentAmount: decimal('2500'), status: 'ACTIVE' },
  { id: 'g2', title: 'Viagem', targetAmount: null, currentAmount: decimal('0'), status: 'PLANNED' },
];
const reminders = [{ id: 'r1', title: 'Cartao', remindAt: NOW }];
const notifications = [{ id: 'n1', title: 'Conta vence', message: 'Amanha', isRead: false, createdAt: NOW }];

const buildFakes = (cached: unknown = null) => {
  const found = jest.fn(async () => ({ id: 'x' }));
  const prisma = {
    user: { findUniqueOrThrow: jest.fn(async ({ select }: any) => (select.timezone ? { timezone: 'America/Sao_Paulo' } : profile)) },
    task: { count: jest.fn(async ({ where }: any) => (where.dueDate.lt ? 1 : 2)), findMany: jest.fn(async () => todayTasks), findFirst: found },
    transaction: {
      groupBy: jest.fn(async () => [
        { type: 'INCOME', _sum: { amount: decimal('1500.5') } },
        { type: 'EXPENSE', _sum: { amount: decimal('320.25') } },
        { type: 'EXPENSE', _sum: { amount: null } },
      ]),
      findMany: jest.fn(async () => transactions),
      aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: decimal(where.type === 'INCOME' ? '2000' : '800') } })),
      findFirst: jest.fn(async () => null),
    },
    goal: { findMany: jest.fn(async () => goals), findFirst: found },
    reminder: { findMany: jest.fn(async () => reminders) },
    notification: { findMany: jest.fn(async () => notifications) },
    recurringTransaction: { findFirst: found },
    assistantTurn: { findFirst: found },
  };
  const cache = { getJson: jest.fn(async () => cached), setJson: jest.fn(async () => undefined), del: jest.fn(async () => undefined) };
  const insights = { list: jest.fn(async () => [{ id: 'i1', kind: 'SAVINGS' }]) };
  const forecasts = { getCurrent: jest.fn(async () => ({ id: 'f1', predictedBalance: 1200 })) };
  const recurring = { materializeDue: jest.fn(async () => 0) };
  const installments = { materializeDue: jest.fn(async () => 0) };
  const service = new DashboardService(prisma as any, cache as any, insights as any, forecasts as any, recurring as any, installments as any);
  return { service, prisma, cache, recurring, installments };
};

describe('DashboardService — caracterizacao do resumo', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());
  it('monta o resumo completo com dados reais', async () => {
    const { service, cache } = buildFakes();
    const summary = await service.getSummary('user-1');
    expect(summary).toMatchSnapshot();
    expect(cache.del).not.toHaveBeenCalled();
    expect(cache.setJson).toHaveBeenCalledWith('dashboard:summary:user-1', summary);
  });
  it('cada consulta recebe where, select, orderBy e take do usuario e da janela certa', async () => {
    const { service, prisma } = buildFakes();
    await service.getSummary('user-1');
    const todayStart = at(0, 0, 0, 0);
    const todayWhere = { userId: 'user-1', dueDate: { gte: todayStart, lte: at(23, 59, 59, 999) }, status: { in: OPEN } };
    const month = { gte: new Date('2026-11-01T00:00:00.000Z'), lt: new Date('2026-11-16T00:00:00.000Z') };
    expect(prisma.user.findUniqueOrThrow).toHaveBeenNthCalledWith(1, { where: { id: 'user-1' }, select: { timezone: true } });
    expect(prisma.user.findUniqueOrThrow).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: 'user-1' } }));
    expect(prisma.task.count).toHaveBeenNthCalledWith(1, { where: todayWhere });
    expect(prisma.task.count).toHaveBeenNthCalledWith(2, { where: { userId: 'user-1', dueDate: { lt: todayStart }, status: { in: OPEN } } });
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: todayWhere, include: { category: true }, orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }], take: 5,
    });
    expect(prisma.transaction.groupBy).toHaveBeenCalledWith({ where: { userId: 'user-1' }, by: ['type'], _sum: { amount: true } });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 6 }),
    );
    for (const type of ['EXPENSE', 'INCOME']) {
      expect(prisma.transaction.aggregate).toHaveBeenCalledWith({ where: { userId: 'user-1', type, date: month }, _sum: { amount: true } });
    }
    expect(prisma.goal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: { in: ['ACTIVE', 'PLANNED', 'ACHIEVED'] } },
        orderBy: [{ status: 'asc' }, { targetDate: 'asc' }], take: 4,
      }),
    );
    expect(prisma.reminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'SCHEDULED', remindAt: { gte: NOW } }, take: 4 }),
    );
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isRead: false }, orderBy: { createdAt: 'desc' }, take: 4 }),
    );
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-1', recurringTransactionId: null }, select: { id: true } });
    expect(prisma.task.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: { id: true } });
  });
  it.each(['recurring', 'installments'] as const)('apaga o cache antes de ler, se criou lancamento (%s)', async (kind) => {
    const { service, cache, recurring, installments } = buildFakes();
    (kind === 'recurring' ? recurring : installments).materializeDue.mockResolvedValueOnce(1);

    await service.getSummary('user-1');

    expect(recurring.materializeDue).toHaveBeenCalledWith('user-1');
    expect(installments.materializeDue).toHaveBeenCalledWith('user-1');
    expect(cache.del).toHaveBeenCalledWith('dashboard:summary:user-1');
    expect(cache.del.mock.invocationCallOrder[0]).toBeLessThan(cache.getJson.mock.invocationCallOrder[0]);
  });

  it('com cache, devolve o cache sem consultar o banco', async () => {
    const { service, prisma } = buildFakes({ fromCache: true });
    await expect(service.getSummary('user-1')).resolves.toEqual({ fromCache: true });
    expect(prisma.task.count).not.toHaveBeenCalled();
  });
});
