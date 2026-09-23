import { Prisma } from '@prisma/client';
import { InstallmentMaterializerService } from './installment-materializer.service';
import { MAX_CATCH_UP_PER_RUN } from '../recurring-transactions/recurring-materializer.service';
import { utcDate } from '../recurring-transactions/recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const decimal = (value: number) => new Prisma.Decimal(value);

type Plan = {
  id: string;
  userId: string;
  description: string;
  totalAmount: Prisma.Decimal;
  installmentAmount: Prisma.Decimal;
  installmentsTotal: number;
  installmentsGenerated: number;
  categoryId: string | null;
  paymentMethod: 'PIX' | 'CREDIT' | 'DEBIT' | null;
  anchorDay: number;
  nextDueDate: Date | null;
  isActive: boolean;
};

const plan = (overrides: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  userId: 'user-1',
  description: 'iPhone',
  totalAmount: decimal(1000),
  installmentAmount: decimal(100),
  installmentsTotal: 10,
  installmentsGenerated: 0,
  categoryId: 'cat-1',
  paymentMethod: 'CREDIT',
  anchorDay: 5,
  nextDueDate: utcDate(2026, 8, 5),
  isActive: true,
  ...overrides,
});

/**
 * Prisma falso com estado em memoria: o updateMany honra o `where` (id +
 * nextDueDate + isActive), que e o que garante a idempotencia de verdade.
 */
const buildPrisma = (plans: Plan[], timezone = 'UTC', existingKeys: string[] = []) => {
  const state = plans.map((item) => ({ ...item }));
  const created: any[] = [];

  const tx = {
    installmentPurchase: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.find(
          (item) =>
            item.id === where.id &&
            item.nextDueDate?.getTime() === where.nextDueDate.getTime() &&
            item.isActive === where.isActive,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        // Indice unico (compra parcelada + numero da parcela) do banco.
        const key = `${data.installmentPurchaseId}:${data.installmentNumber}`;
        if (existingKeys.includes(key)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
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
      updateMany: tx.installmentPurchase.updateMany,
    },
    user: { findUnique: jest.fn().mockResolvedValue({ timezone }) },
    // Como o banco: se algo dentro da transacao falha, a reivindicacao e desfeita.
    $transaction: jest.fn(async (callback: any) => {
      const snapshot = state.map((row) => ({ ...row }));
      try {
        return await callback(tx);
      } catch (error) {
        state.forEach((row, index) => Object.assign(row, snapshot[index]));
        throw error;
      }
    }),
  };

  return { prisma, state, created };
};

const service = (prisma: unknown) => new InstallmentMaterializerService(prisma as any);

describe('InstallmentMaterializerService', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('nao faz nada (nem consulta o usuario) quando nada esta vencido', async () => {
    const { prisma, created } = buildPrisma([plan({ nextDueDate: utcDate(2026, 9, 5) })]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(0);
    expect(created).toHaveLength(0);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('gera a parcela vencida com a data, o numero e o vinculo com a compra', async () => {
    const { prisma, created, state } = buildPrisma([plan()]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(1);
    expect(created[0]).toMatchObject({
      userId: 'user-1',
      type: 'EXPENSE',
      description: 'iPhone',
      categoryId: 'cat-1',
      installmentPurchaseId: 'plan-1',
      installmentNumber: 1,
      installmentsTotal: 10,
    });
    expect(created[0].amount.toString()).toBe('100');
    expect(iso(created[0].date)).toBe('2026-09-05');
    expect(iso(state[0].nextDueDate)).toBe('2026-10-05');
    expect(state[0].installmentsGenerated).toBe(1);
    expect(state[0].isActive).toBe(true);
  });

  it('e idempotente: rodar de novo no mesmo dia nao gera outra parcela', async () => {
    const { prisma, created } = buildPrisma([plan()]);
    const materializer = service(prisma);

    await materializer.materializeDue('user-1', now);
    const second = await materializer.materializeDue('user-1', now);

    expect(second).toBe(0);
    expect(created).toHaveLength(1);
  });

  it('duas chamadas simultaneas geram a parcela uma vez so', async () => {
    const { prisma, created } = buildPrisma([plan()]);
    const materializer = service(prisma);

    const [a, b] = await Promise.all([
      materializer.materializeDue('user-1', now),
      materializer.materializeDue('user-1', now),
    ]);

    expect(a + b).toBe(1);
    expect(created).toHaveLength(1);
  });

  it('recupera parcelas perdidas em ordem (app ficou fechado)', async () => {
    const { prisma, created, state } = buildPrisma([
      plan({ nextDueDate: utcDate(2026, 6, 5) }), // 05/07
    ]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(3);
    expect(created.map((item) => iso(item.date))).toEqual(['2026-07-05', '2026-08-05', '2026-09-05']);
    expect(created.map((item) => item.installmentNumber)).toEqual([1, 2, 3]);
    expect(state[0].installmentsGenerated).toBe(3);
  });

  it('para exatamente em installmentsTotal, mesmo com muito tempo perdido', async () => {
    const { prisma, created, state } = buildPrisma([
      plan({
        installmentsTotal: 3,
        installmentsGenerated: 0,
        nextDueDate: utcDate(2024, 0, 5),
      }),
    ]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(3);
    expect(created).toHaveLength(3);
    expect(created.map((item) => item.installmentNumber)).toEqual([1, 2, 3]);
    expect(state[0].isActive).toBe(false);
    expect(state[0].nextDueDate).toBeNull();
  });

  it('limita a recuperacao por rodada (mesmo teto das contas fixas)', async () => {
    const { prisma, created } = buildPrisma([
      plan({ installmentsTotal: 60, nextDueDate: utcDate(2020, 0, 1) }),
    ]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(MAX_CATCH_UP_PER_RUN);
    expect(created).toHaveLength(MAX_CATCH_UP_PER_RUN);
  });

  it('a ultima parcela absorve a sobra do arredondamento', async () => {
    // 100 / 3 = 33.33 (x2) + 33.34 na ultima, pra somar 100.00 certinho.
    const { prisma, created } = buildPrisma([
      plan({
        totalAmount: decimal(100),
        installmentAmount: decimal(33.33),
        installmentsTotal: 3,
        installmentsGenerated: 2,
        nextDueDate: utcDate(2026, 8, 5),
      }),
    ]);

    await service(prisma).materializeDue('user-1', now);

    expect(created[0].installmentNumber).toBe(3);
    expect(created[0].amount.toString()).toBe('33.34');
  });

  it('respeita o fuso: 23:30 do dia 4 em Sao Paulo ainda nao e dia 5', async () => {
    const early = new Date('2026-09-05T02:30:00.000Z');
    const local = buildPrisma([plan()], 'America/Sao_Paulo');
    const utc = buildPrisma([plan()], 'UTC');

    expect(await service(local.prisma).materializeDue('user-1', early)).toBe(0);
    expect(await service(utc.prisma).materializeDue('user-1', early)).toBe(1);
  });

  it('nao gera nada para compra ja encerrada (isActive=false)', async () => {
    const { prisma, created } = buildPrisma([plan({ isActive: false })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('nao mexe em compra de outro usuario', async () => {
    const { prisma, created } = buildPrisma([plan({ userId: 'user-2' })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('a parcela herda a forma de pagamento e a categoria da compra', async () => {
    const { prisma, created } = buildPrisma([plan({ paymentMethod: 'CREDIT', categoryId: 'cat-9' })]);

    await service(prisma).materializeDue('user-1', now);

    expect(created[0].paymentMethod).toBe('CREDIT');
    expect(created[0].categoryId).toBe('cat-9');
  });

  describe('trava de unicidade do banco (compra + numero da parcela)', () => {
    it('parcela que ja existe: avanca o calendario sem gerar nem falhar', async () => {
      const { prisma, created, state } = buildPrisma([plan()], 'UTC', ['plan-1:1']);

      const count = await service(prisma).materializeDue('user-1', now);

      expect(count).toBe(0);
      expect(created).toHaveLength(0);
      expect(iso(state[0].nextDueDate)).toBe('2026-10-05');
      expect(state[0].installmentsGenerated).toBe(1);
    });

    it('erro que nao e de unicidade continua subindo (nao e engolido)', async () => {
      const { prisma } = buildPrisma([plan()]);
      prisma.$transaction.mockRejectedValueOnce(new Error('conexao caiu'));

      await expect(service(prisma).materializeDue('user-1', now)).rejects.toThrow('conexao caiu');
    });
  });
});
