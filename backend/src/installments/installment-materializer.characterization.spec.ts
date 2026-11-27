import { Prisma } from '@prisma/client';
import { InstallmentMaterializerService } from './installment-materializer.service';
import { utcDate } from '../recurring-transactions/recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const now = new Date('2026-09-20T12:00:00.000Z');

const plan = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  userId: 'user-1',
  description: 'iPhone',
  totalAmount: new Prisma.Decimal(1000),
  installmentAmount: new Prisma.Decimal(100),
  installmentsTotal: 10,
  installmentsGenerated: 0,
  anchorDay: 5,
  nextDueDate: utcDate(2026, 8, 5),
  isActive: true,
  ...overrides,
});

/** Prisma falso: o updateMany honra id + nextDueDate + isActive. `stolen` simula outra chamada que levou a parcela. */
function fakePrisma(rows: any[], { stolen = false, timezone = 'UTC' } = {}) {
  const state = rows.map((row) => ({ ...row }));
  const created: any[] = [];
  const claim = jest.fn(async ({ where, data }: any) => {
    const row = state.find(
      (item) =>
        !stolen &&
        item.id === where.id &&
        item.nextDueDate?.getTime() === where.nextDueDate.getTime() &&
        item.isActive === where.isActive,
    );
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const tx = {
    installmentPurchase: { updateMany: claim },
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    installmentPurchase: {
      findMany: jest.fn(async ({ where }: any) =>
        state
          .filter((item) => item.userId === where.userId && item.isActive === where.isActive)
          .filter((item) => item.nextDueDate && item.nextDueDate <= where.nextDueDate.lte)
          .map((item) => ({ ...item })),
      ),
      updateMany: claim,
    },
    user: { findUnique: jest.fn().mockResolvedValue({ timezone }) },
    $transaction: jest.fn((callback: any) => callback(tx)),
  };

  return { prisma, state, created, claim };
}

const service = (prisma: unknown) => new InstallmentMaterializerService(prisma as any);

describe('InstallmentMaterializerService (caracterizacao)', () => {
  it('dia 31: cai no ultimo dia de meses curtos e volta ao 31', async () => {
    const { prisma, created, state } = fakePrisma([
      plan({
        anchorDay: 31,
        nextDueDate: utcDate(2026, 0, 31),
        installmentsTotal: 12,
      }),
    ]);

    const count = await service(prisma).materializeDue('user-1', new Date('2026-03-31T12:00:00.000Z'));

    expect(count).toBe(3);
    expect(created.map((item) => iso(item.date))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(iso(state[0].nextDueDate)).toBe('2026-04-30');
    expect(state[0].installmentsGenerated).toBe(3);
  });

  it('compra com todas as parcelas ja geradas: nao reivindica nada', async () => {
    const { prisma, created, claim } = fakePrisma([plan({ installmentsGenerated: 10 })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(claim).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('fuso a frente (Toquio): parcela de amanha em UTC ja vence hoje local', async () => {
    // 18:00 UTC de 20/09 = 03:00 de 21/09 em Toquio.
    const { prisma, created } = fakePrisma([plan({ nextDueDate: utcDate(2026, 8, 21) })], { timezone: 'Asia/Tokyo' });

    expect(await service(prisma).materializeDue('user-1', new Date('2026-09-20T18:00:00.000Z'))).toBe(1);
    expect(iso(created[0].date)).toBe('2026-09-21');
  });

  it('outra chamada levou a parcela: para a compra no primeiro vencimento e nao gera nada', async () => {
    const { prisma, created, claim, state } = fakePrisma([plan({ nextDueDate: utcDate(2026, 6, 5) })], {
      stolen: true,
    });

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
    expect(iso(state[0].nextDueDate)).toBe('2026-07-05');
  });
});
