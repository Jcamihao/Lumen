import { TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { analyzeSpending } from './spending-analysis';

const NOW = new Date('2026-11-15T12:00:00.000Z');

type Row = { type: TransactionType; amount: number; date: string; category: { name: string } | null };

const expense = (amount: number, date: string, name = 'Lazer'): Row => ({
  type: TransactionType.EXPENSE,
  amount,
  date,
  category: { name },
});

const prismaWith = (rows: Row[]) => {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }) },
    transaction: { findMany },
  } as unknown as PrismaService;
  return { prisma, findMany };
};

describe('analyzeSpending (consulta e limiares)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('consulta so o usuario, desde o dia 1 de dois meses atras, com os tres tipos', async () => {
    const { prisma, findMany } = prismaWith([]);
    await analyzeSpending(prisma, 'user-1');
    const { where } = findMany.mock.calls[0][0];
    expect(where.userId).toBe('user-1');
    expect(where.date).toEqual({ gte: new Date('2026-09-01T00:00:00.000Z') });
    expect(where.type).toEqual({
      in: [TransactionType.INCOME, TransactionType.EXPENSE, TransactionType.TRANSFER],
    });
  });

  it('uma unica transacao ja gera sobra media (dividida por 3)', async () => {
    const { prisma } = prismaWith([{ ...expense(30, '2026-11-03T00:00:00.000Z'), category: null }]);
    expect(await analyzeSpending(prisma, 'user-1')).toEqual({ topVariableCategory: null, avgMonthlySurplus: -10 });
  });

  it('categoria com oscilacao de cerca de 25% e variavel; de cerca de 15% e fixa', async () => {
    const monthly = (name: string, values: number[]) =>
      ['2026-09-10', '2026-10-10', '2026-11-10'].map((day, i) => expense(values[i], day + 'T00:00:00.000Z', name));
    const { prisma } = prismaWith([...monthly('Oscila', [70, 100, 130]), ...monthly('Quase fixa', [85, 100, 115])]);
    const result = await analyzeSpending(prisma, 'user-1');
    expect(result.topVariableCategory).toEqual({ name: 'Oscila', total: 300 });
  });
});
