import { RecurrenceFrequency, TransactionType } from '@prisma/client';
import { MAX_CATCH_UP_PER_RUN, RecurringMaterializerService } from './recurring-materializer.service';
import { utcDate } from './recurrence.util';

const iso = (date: Date) => date.toISOString().slice(0, 10);

type Template = {
  id: string;
  userId: string;
  type: TransactionType;
  description: string;
  amount: number;
  categoryId: string | null;
  frequency: RecurrenceFrequency;
  anchorDay: number;
  nextDueDate: Date;
  endDate: Date | null;
  isActive: boolean;
};

const template = (overrides: Partial<Template> = {}): Template => ({
  id: 'rec-1',
  userId: 'user-1',
  type: TransactionType.EXPENSE,
  description: 'Aluguel',
  amount: 1200,
  categoryId: 'cat-1',
  frequency: RecurrenceFrequency.MONTHLY,
  anchorDay: 5,
  nextDueDate: utcDate(2026, 8, 5),
  endDate: null,
  isActive: true,
  ...overrides,
});

/**
 * Prisma falso com estado em memoria: o updateMany honra o `where` (id +
 * nextDueDate + isActive), que e o que garante a idempotencia de verdade.
 */
const buildPrisma = (templates: Template[], timezone = 'UTC') => {
  const state = templates.map((item) => ({ ...item }));
  const created: any[] = [];

  const tx = {
    recurringTransaction: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.find(
          (item) =>
            item.id === where.id &&
            item.nextDueDate.getTime() === where.nextDueDate.getTime() &&
            item.isActive === where.isActive,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    recurringTransaction: {
      findMany: jest.fn(async ({ where }: any) =>
        state
          .filter((item) => item.userId === where.userId && item.isActive === where.isActive)
          .filter((item) => item.nextDueDate <= where.nextDueDate.lte)
          .map((item) => ({ ...item })),
      ),
      updateMany: tx.recurringTransaction.updateMany,
    },
    user: { findUnique: jest.fn().mockResolvedValue({ timezone }) },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };

  return { prisma, state, created };
};

const service = (prisma: unknown) => new RecurringMaterializerService(prisma as any);

describe('RecurringMaterializerService', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('nao faz nada (nem consulta o usuario) quando nada esta vencido', async () => {
    const { prisma, created } = buildPrisma([template({ nextDueDate: utcDate(2026, 9, 5) })]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(0);
    expect(created).toHaveLength(0);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('gera o lancamento vencido com a data do vencimento e o vinculo com a conta', async () => {
    const { prisma, created, state } = buildPrisma([template()]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(1);
    expect(created[0]).toMatchObject({
      userId: 'user-1',
      type: TransactionType.EXPENSE,
      description: 'Aluguel',
      amount: 1200,
      categoryId: 'cat-1',
      recurringTransactionId: 'rec-1',
    });
    expect(iso(created[0].date)).toBe('2026-09-05');
    expect(iso(state[0].nextDueDate)).toBe('2026-10-05');
  });

  it('e idempotente: rodar de novo no mesmo dia nao gera outro', async () => {
    const { prisma, created } = buildPrisma([template()]);
    const materializer = service(prisma);

    await materializer.materializeDue('user-1', now);
    const second = await materializer.materializeDue('user-1', now);

    expect(second).toBe(0);
    expect(created).toHaveLength(1);
  });

  it('duas chamadas simultaneas geram o vencimento uma vez so', async () => {
    const { prisma, created } = buildPrisma([template()]);
    const materializer = service(prisma);

    const [a, b] = await Promise.all([
      materializer.materializeDue('user-1', now),
      materializer.materializeDue('user-1', now),
    ]);

    expect(a + b).toBe(1);
    expect(created).toHaveLength(1);
  });

  it('recupera vencimentos perdidos em ordem (app ficou fechado)', async () => {
    const { prisma, created, state } = buildPrisma([
      template({ nextDueDate: utcDate(2026, 6, 5) }), // 05/07
    ]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(3);
    expect(created.map((item) => iso(item.date))).toEqual(['2026-07-05', '2026-08-05', '2026-09-05']);
    expect(iso(state[0].nextDueDate)).toBe('2026-10-05');
  });

  it('limita a recuperacao por rodada', async () => {
    const { prisma, created } = buildPrisma([
      template({ frequency: RecurrenceFrequency.WEEKLY, anchorDay: 1, nextDueDate: utcDate(2024, 0, 1) }),
    ]);

    const count = await service(prisma).materializeDue('user-1', now);

    expect(count).toBe(MAX_CATCH_UP_PER_RUN);
    expect(created).toHaveLength(MAX_CATCH_UP_PER_RUN);
  });

  it('respeita o fuso: 23:30 do dia 4 em Sao Paulo ainda nao e dia 5', async () => {
    // 02:30 UTC de 05/09 = 23:30 de 04/09 em Sao Paulo.
    const early = new Date('2026-09-05T02:30:00.000Z');
    const local = buildPrisma([template()], 'America/Sao_Paulo');
    const utc = buildPrisma([template()], 'UTC');

    expect(await service(local.prisma).materializeDue('user-1', early)).toBe(0);
    expect(await service(utc.prisma).materializeDue('user-1', early)).toBe(1);
  });

  it('respeita o fuso para a frente: vence assim que o dia local vira', async () => {
    // 03:10 UTC de 05/09 = 00:10 de 05/09 em Sao Paulo.
    const justAfter = new Date('2026-09-05T03:10:00.000Z');
    const { prisma } = buildPrisma([template()], 'America/Sao_Paulo');

    expect(await service(prisma).materializeDue('user-1', justAfter)).toBe(1);
  });

  it('encerra a conta depois do ultimo vencimento dentro da data final', async () => {
    const { prisma, created, state } = buildPrisma([
      template({ nextDueDate: utcDate(2026, 8, 5), endDate: utcDate(2026, 8, 30) }),
    ]);

    await service(prisma).materializeDue('user-1', now);

    expect(created).toHaveLength(1);
    expect(state[0].isActive).toBe(false);
  });

  it('nao gera nada para conta pausada', async () => {
    const { prisma, created } = buildPrisma([template({ isActive: false })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('nao mexe em conta de outro usuario', async () => {
    const { prisma, created } = buildPrisma([template({ userId: 'user-2' })]);

    expect(await service(prisma).materializeDue('user-1', now)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('gera receita recorrente do tipo certo', async () => {
    const { prisma, created } = buildPrisma([
      template({ type: TransactionType.INCOME, description: 'Salario', amount: 5000 }),
    ]);

    await service(prisma).materializeDue('user-1', now);

    expect(created[0]).toMatchObject({ type: TransactionType.INCOME, description: 'Salario' });
  });
});
