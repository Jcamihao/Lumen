import { TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { analyzeSpending } from './spending-analysis';

const NOW = new Date('2026-11-15T12:00:00.000Z');

type Row = { type: TransactionType; amount: number | string; date: string; category: { name: string } | null };

const row = (type: TransactionType, amount: number | string, date: string, category: string | null = 'Lazer'): Row => ({
  type,
  amount,
  date,
  category: category === null ? null : { name: category },
});
const expense = (amount: number | string, date: string, category: string | null = 'Lazer') =>
  row(TransactionType.EXPENSE, amount, date, category);
const income = (amount: number, date: string) => row(TransactionType.INCOME, amount, date, null);

const SEP = '2026-09-01T00:00:00.000Z';
const OCT = '2026-10-15T00:00:00.000Z';
const NOV = '2026-11-03T00:00:00.000Z';

const prismaWith = (rows: Row[], timezone: string | null = 'America/Sao_Paulo') =>
  ({
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone }) },
    transaction: { findMany: jest.fn().mockResolvedValue(rows) },
  }) as unknown as PrismaService;

const cases: Array<[string, Row[]]> = [
  ['sem transacoes', []],
  ['so receita: sobra positiva e sem categoria', [income(3000, OCT), income(3000, NOV)]],
  ['gasto fixo igual todo mes fica fora do corte', [SEP, OCT, NOV].map((date) => expense(1500, date, 'Aluguel'))],
  [
    'variavel vence fixa e transferencia conta como saida',
    [
      expense(100, SEP),
      expense(400, OCT),
      expense(50, NOV),
      expense(1500, SEP, 'Aluguel'),
      expense(1500, OCT, 'Aluguel'),
      expense(1500, NOV, 'Aluguel'),
      row(TransactionType.TRANSFER, 200, NOV, 'Poupanca'),
      income(4000, NOV),
    ],
  ],
  ['empate no total: primeira categoria do mapa vence', [expense(300, NOV, 'Cinema'), expense(300, NOV, 'Bar')]],
  ['valor zero e despesa sem categoria sao ignorados', [expense(0, NOV), expense(500, NOV, null)]],
  ['valor como texto decimal', [expense('250.75', OCT), expense('10.25', NOV)]],
  [
    'borda do dia 1 e meses fora da janela',
    [
      expense(90, '2026-08-31T23:59:59.000Z'),
      expense(70, SEP),
      expense(120, '2026-12-01T00:00:00.000Z'),
      income(1000, SEP),
    ],
  ],
];

describe('analyzeSpending (caracterizacao)', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it.each(cases)('%s', async (_name, rows) => {
    expect(await analyzeSpending(prismaWith(rows), 'user-1')).toMatchSnapshot();
  });

  it('fuso ausente usa Sao Paulo; fuso invalido cai em UTC', async () => {
    jest.setSystemTime(new Date('2026-11-01T02:00:00.000Z'));
    const rows = [expense(100, '2026-08-01T00:00:00.000Z'), expense(200, '2026-09-01T00:00:00.000Z')];
    expect(await analyzeSpending(prismaWith(rows, null), 'user-1')).toMatchSnapshot();
    expect(await analyzeSpending(prismaWith(rows, 'Mars/Base'), 'user-1')).toMatchSnapshot();
  });
});
