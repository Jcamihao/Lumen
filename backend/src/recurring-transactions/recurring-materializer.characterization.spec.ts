import { RecurrenceFrequency, TransactionType } from '@prisma/client';
import { RecurringMaterializerService } from './recurring-materializer.service';
import { utcDate } from './recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const now = new Date('2026-09-20T12:00:00.000Z');

const template = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  userId: 'user-1',
  type: TransactionType.EXPENSE,
  description: 'Aluguel',
  amount: 1200,
  frequency: RecurrenceFrequency.MONTHLY,
  anchorDay: 5,
  nextDueDate: utcDate(2026, 8, 5),
  endDate: null,
  isActive: true,
  lastGeneratedAt: null as Date | null,
  ...overrides,
});

const sameRow = (item: any, where: any) =>
  item.id === where.id && item.nextDueDate.getTime() === where.nextDueDate.getTime() && item.isActive === where.isActive;

/** Prisma falso: o updateMany honra id + nextDueDate + isActive. `stolen` simula outra chamada que levou o vencimento. */
function fakePrisma(rows: any[], { stolen = false, timezone = 'UTC' } = {}) {
  const state = rows.map((row) => ({ ...row }));
  const created: any[] = [];
  const claim = jest.fn(async ({ where, data }: any) => {
    const row = stolen ? undefined : state.find((item) => sameRow(item, where));
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const tx = {
    recurringTransaction: { updateMany: claim },
    transaction: { create: jest.fn(async ({ data }: any) => created.push(data)) },
  };
  const prisma = {
    recurringTransaction: {
      findMany: jest.fn(async ({ where }: any) =>
        state.filter(
          (item) => item.userId === where.userId && item.isActive === where.isActive && item.nextDueDate <= where.nextDueDate.lte,
        ),
      ),
      updateMany: claim,
    },
    user: { findUnique: jest.fn().mockResolvedValue({ timezone }) },
    $transaction: jest.fn((callback: any) => callback(tx)),
  };

  return { prisma, state, created, claim };
}

const service = (prisma: unknown) => new RecurringMaterializerService(prisma as any);

describe('RecurringMaterializerService (caracterizacao)', () => {
  it('dia 31 mensal: cai no ultimo dia de meses curtos e volta ao 31', async () => {
    const { prisma, created, state } = fakePrisma([template({ anchorDay: 31, nextDueDate: utcDate(2026, 0, 31) })]);

    const count = await service(prisma).materializeDue('user-1', new Date('2026-03-31T12:00:00.000Z'));

    expect(count).toBe(3);
    expect(created.map((item) => iso(item.date))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(iso(state[0].nextDueDate)).toBe('2026-04-30');
  });

  it('data final igual a um vencimento: inclui esse vencimento e encerra depois dele', async () => {
    const { prisma, created, state } = fakePrisma([template({ endDate: utcDate(2026, 8, 5), nextDueDate: utcDate(2026, 7, 5) })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(2);
    expect(created.map((item) => iso(item.date))).toEqual(['2026-08-05', '2026-09-05']);
    expect(state[0].isActive).toBe(false);
    expect(iso(state[0].nextDueDate)).toBe('2026-10-05');
    expect(state[0].lastGeneratedAt).toEqual(now);
  });

  it('data final antes do proximo vencimento: gera os que cabem e desativa na ultima', async () => {
    const { prisma, created, state } = fakePrisma([
      template({ endDate: utcDate(2026, 6, 20), nextDueDate: utcDate(2026, 5, 5) }),
    ]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(2);
    expect(created.map((item) => iso(item.date))).toEqual(['2026-06-05', '2026-07-05']);
    expect(state[0].isActive).toBe(false);
    expect(iso(state[0].nextDueDate)).toBe('2026-08-05');
  });

  it('vencimento ja depois da data final: desativa sem gerar lancamento', async () => {
    const { prisma, created, state } = fakePrisma([template({ endDate: utcDate(2026, 6, 1), nextDueDate: utcDate(2026, 7, 5) })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(created).toHaveLength(0);
    expect(state[0].isActive).toBe(false);
    expect(iso(state[0].nextDueDate)).toBe('2026-08-05');
    expect(state[0].lastGeneratedAt).toBeNull();
  });

  it('outra chamada levou o vencimento: para a conta e nao gera nada', async () => {
    const { prisma, created, claim, state } = fakePrisma([template({ nextDueDate: utcDate(2026, 6, 5) })], {
      stolen: true,
    });

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
    expect(iso(state[0].nextDueDate)).toBe('2026-07-05');
  });

  it('fuso a frente (Toquio): vencimento de amanha em UTC ja vence hoje local', async () => {
    // 18:00 UTC de 20/09 = 03:00 de 21/09 em Toquio.
    const { prisma, created } = fakePrisma([template({ nextDueDate: utcDate(2026, 8, 21) })], {
      timezone: 'Asia/Tokyo',
    });

    expect(await service(prisma).materializeDue('user-1', new Date('2026-09-20T18:00:00.000Z'))).toBe(1);
    expect(iso(created[0].date)).toBe('2026-09-21');
  });
});
