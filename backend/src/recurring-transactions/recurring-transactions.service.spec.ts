import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecurrenceFrequency, TransactionType } from '@prisma/client';
import { utcDate } from './recurrence.util';
import { RecurringTransactionsService } from './recurring-transactions.service';

const iso = (date: Date) => date.toISOString().slice(0, 10);

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  userId: 'user-1',
  type: TransactionType.EXPENSE,
  description: 'Aluguel',
  amount: 1200,
  categoryId: null,
  frequency: RecurrenceFrequency.MONTHLY,
  anchorDay: 5,
  nextDueDate: utcDate(2027, 0, 5),
  endDate: null,
  isActive: true,
  category: null,
  ...overrides,
});

const build = (existing: any = stored(), options: { category?: any; timezone?: string } = {}) => {
  const prisma = {
    recurringTransaction: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rec-new', ...data })),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    financeCategory: {
      findFirst: jest.fn().mockResolvedValue(options.category ?? null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ timezone: options.timezone ?? 'UTC' }),
    },
  };
  const materializer = { materializeDue: jest.fn().mockResolvedValue(0) };
  const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
  const service = new RecurringTransactionsService(prisma as any, materializer as any, lifeEngine as any);

  return { service, prisma, materializer, lifeEngine };
};

const today = () => {
  const now = new Date();
  return utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};
const dayString = (date: Date) => iso(date);

const validCreate = (overrides: Record<string, unknown> = {}) => ({
  type: TransactionType.EXPENSE,
  description: '  Aluguel  ',
  amount: 1200,
  frequency: RecurrenceFrequency.MONTHLY,
  firstDueDate: dayString(utcDate(today().getUTCFullYear(), today().getUTCMonth() + 1, 5)),
  ...overrides,
});

describe('RecurringTransactionsService', () => {
  describe('list', () => {
    it('gera o que venceu antes de listar e devolve valores numericos', async () => {
      const { service, prisma, materializer, lifeEngine } = build();
      materializer.materializeDue.mockResolvedValue(1);
      prisma.recurringTransaction.findMany.mockResolvedValue([
        stored({ amount: { valueOf: () => 99.9, toString: () => '99.9' } }),
      ]);

      const result = await service.list('user-1');

      expect(materializer.materializeDue).toHaveBeenCalledWith('user-1');
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
      expect(result[0].amount).toBe(99.9);
    });

    it('so lista as contas do proprio usuario', async () => {
      const { service, prisma } = build();

      await service.list('user-1');

      expect(prisma.recurringTransaction.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    });
  });

  describe('create', () => {
    it('grava o dia de referencia a partir do primeiro vencimento e limpa a descricao', async () => {
      const { service, prisma, materializer } = build();
      const dto = validCreate({ firstDueDate: dayString(utcDate(today().getUTCFullYear(), today().getUTCMonth() + 1, 17)) });

      await service.create('user-1', dto as any);

      const data = prisma.recurringTransaction.create.mock.calls[0][0].data;
      expect(data.anchorDay).toBe(17);
      expect(data.description).toBe('Aluguel');
      expect(data.userId).toBe('user-1');
      // Ja tenta gerar (caso o primeiro vencimento seja hoje ou passado).
      expect(materializer.materializeDue).toHaveBeenCalled();
    });

    it('grava a forma de pagamento da conta fixa', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate({ paymentMethod: 'PIX' }) as any);

      expect(prisma.recurringTransaction.create.mock.calls[0][0].data.paymentMethod).toBe('PIX');
    });

    it('sem informar, grava null', async () => {
      const { service, prisma } = build();

      await service.create('user-1', validCreate() as any);

      expect(prisma.recurringTransaction.create.mock.calls[0][0].data.paymentMethod).toBeNull();
    });

    it('aceita primeiro vencimento a partir do mes passado', async () => {
      const { service } = build();
      const lastMonth = utcDate(today().getUTCFullYear(), today().getUTCMonth() - 1, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(lastMonth) }) as any),
      ).resolves.toBeDefined();
    });

    it('recusa primeiro vencimento anterior ao mes passado (sem historico em massa)', async () => {
      const { service, prisma } = build();
      const old = utcDate(today().getUTCFullYear(), today().getUTCMonth() - 2, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(old) }) as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('recusa primeiro vencimento a mais de 2 anos', async () => {
      const { service } = build();
      const far = utcDate(today().getUTCFullYear() + 3, 0, 1);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(far) }) as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa data final antes do primeiro vencimento', async () => {
      const { service } = build();
      const first = utcDate(today().getUTCFullYear(), today().getUTCMonth() + 2, 10);
      const end = utcDate(today().getUTCFullYear(), today().getUTCMonth() + 2, 5);

      await expect(
        service.create('user-1', validCreate({ firstDueDate: dayString(first), endDate: dayString(end) }) as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa categoria de outro tipo (categoria de receita em despesa)', async () => {
      const { service, prisma } = build(stored(), {
        category: { id: 'cat-1', userId: 'user-1', type: TransactionType.INCOME },
      });

      await expect(
        service.create('user-1', validCreate({ categoryId: 'cat-1' }) as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recurringTransaction.create).not.toHaveBeenCalled();
    });

    it('recusa categoria que nao e do usuario', async () => {
      const { service } = build(stored(), { category: null });

      await expect(
        service.create('user-1', validCreate({ categoryId: 'cat-alheia' }) as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('so mexe em conta do proprio usuario', async () => {
      const { service, prisma } = build(null);

      await expect(service.update('user-1', 'rec-alheia', { amount: 10 })).rejects.toThrow(NotFoundException);
      expect(prisma.recurringTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rec-alheia', userId: 'user-1' } }),
      );
      expect(prisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    it('altera valor e descricao sem tocar no calendario', async () => {
      const { service, prisma } = build();

      await service.update('user-1', 'rec-1', { amount: 1350, description: 'Aluguel novo' });

      const data = prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(Number(data.amount)).toBe(1350);
      expect(data.description).toBe('Aluguel novo');
      expect(data.nextDueDate).toBeUndefined();
    });

    it('troca e limpa a forma de pagamento', async () => {
      const changed = build();
      await changed.service.update('user-1', 'rec-1', { paymentMethod: 'DEBIT' });
      expect(changed.prisma.recurringTransaction.update.mock.calls[0][0].data.paymentMethod).toBe('DEBIT');

      const cleared = build();
      await cleared.service.update('user-1', 'rec-1', { paymentMethod: null });
      expect(cleared.prisma.recurringTransaction.update.mock.calls[0][0].data.paymentMethod).toBeNull();
    });

    it('pausar so liga o interruptor', async () => {
      const { service, prisma, materializer } = build();

      await service.update('user-1', 'rec-1', { isActive: false });

      const data = prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(false);
      expect(data.nextDueDate).toBeUndefined();
      expect(materializer.materializeDue).not.toHaveBeenCalled();
    });

    it('retomar pula os vencimentos da pausa em vez de despeja-los', async () => {
      // Pausada desde 05/2020: ao retomar, o proximo vencimento e a partir de hoje.
      const { service, prisma } = build(
        stored({ isActive: false, nextDueDate: utcDate(2020, 4, 5), anchorDay: 5 }),
      );

      await service.update('user-1', 'rec-1', { isActive: true });

      const data = prisma.recurringTransaction.update.mock.calls[0][0].data;
      expect(data.isActive).toBe(true);
      expect(data.nextDueDate.getTime()).toBeGreaterThanOrEqual(today().getTime());
      expect(data.nextDueDate.getUTCDate()).toBe(5);
    });

    it('remove a data final com null', async () => {
      const { service, prisma } = build(stored({ endDate: utcDate(2027, 5, 1) }));

      await service.update('user-1', 'rec-1', { endDate: null });

      expect(prisma.recurringTransaction.update.mock.calls[0][0].data.endDate).toBeNull();
    });

    it('recusa retomar uma conta que ja passou da data final', async () => {
      const { service } = build(
        stored({ isActive: false, nextDueDate: utcDate(2027, 5, 5), endDate: utcDate(2027, 0, 1) }),
      );

      await expect(service.update('user-1', 'rec-1', { isActive: true })).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('apaga so a conta do proprio usuario e recalcula os insights', async () => {
      const { service, prisma, lifeEngine } = build();

      await service.remove('user-1', 'rec-1');

      expect(prisma.recurringTransaction.delete).toHaveBeenCalledWith({ where: { id: 'rec-1' } });
      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });

    it('responde 404 para conta alheia', async () => {
      const { service, prisma } = build(null);

      await expect(service.remove('user-1', 'rec-alheia')).rejects.toThrow(NotFoundException);
      expect(prisma.recurringTransaction.delete).not.toHaveBeenCalled();
    });
  });
});
