import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GoalStatus, TransactionType } from '@prisma/client';
import { GoalsService } from './goals.service';

const decimal = (value: number) => ({ toString: () => String(value), valueOf: () => value });

describe('GoalsService', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'goal-1',
    userId: 'user-1',
    title: 'Viagem',
    targetAmount: decimal(3000),
    currentAmount: decimal(800),
    status: GoalStatus.ACTIVE,
    ...overrides,
  });

  const build = (existing: unknown = stored()) => {
    const prisma = {
      goal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'goal-new', ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ ...(existing as object), ...data }),
        ),
      },
      transaction: { create: jest.fn().mockResolvedValue({}) },
    };
    const lifeEngine = { touchUserData: jest.fn().mockResolvedValue(undefined) };
    const notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
    const service = new GoalsService(prisma as any, lifeEngine as any, notifications as any);

    return { service, prisma, lifeEngine };
  };

  describe('create', () => {
    it('sem targetAmount, cria a meta como "cofrinho" sem valor-alvo (nao vira 0)', async () => {
      const { service, prisma } = build();

      await service.create('user-1', { title: 'Reserva de emergência' } as any);

      expect(prisma.goal.create.mock.calls[0][0].data.targetAmount).toBeUndefined();
    });

    it('targetAmount null explicito (nao so ausente) tambem cria sem valor-alvo, sem quebrar', async () => {
      const { service, prisma } = build();

      await service.create('user-1', { title: 'Reserva', targetAmount: null } as any);

      expect(prisma.goal.create.mock.calls[0][0].data.targetAmount).toBeUndefined();
    });

    it('com targetAmount, grava o Decimal normalmente', async () => {
      const { service, prisma } = build();

      await service.create('user-1', { title: 'Viagem', targetAmount: 5000 } as any);

      expect(Number(prisma.goal.create.mock.calls[0][0].data.targetAmount)).toBe(5000);
    });

    it('meta sem alvo criada volta com targetAmount null na resposta (nao 0)', async () => {
      const { service } = build();

      const result = await service.create('user-1', { title: 'Reserva' } as any);

      expect(result.targetAmount).toBeNull();
    });
  });

  describe('update', () => {
    it('null limpa o valor-alvo (meta vira cofrinho sem proposito)', async () => {
      const { service, prisma } = build();

      await service.update('user-1', 'goal-1', { targetAmount: null } as any);

      expect(prisma.goal.update.mock.calls[0][0].data.targetAmount).toBeNull();
    });

    it('nao informado, nao mexe no valor-alvo existente', async () => {
      const { service, prisma } = build();

      await service.update('user-1', 'goal-1', { title: 'Viagem 2' } as any);

      expect(prisma.goal.update.mock.calls[0][0].data.targetAmount).toBeUndefined();
    });
  });

  describe('contribute', () => {
    it('meta com alvo: aporte que atinge o valor marca ACHIEVED', async () => {
      const { service, prisma } = build(stored({ currentAmount: decimal(2900) }));

      await service.contribute('user-1', 'goal-1', { amount: 200 } as any);

      expect(prisma.goal.update.mock.calls[0][0].data.status).toBe(GoalStatus.ACHIEVED);
    });

    it('meta SEM alvo: aporte grande nao marca ACHIEVED sozinho', async () => {
      const { service, prisma } = build(stored({ targetAmount: null, currentAmount: decimal(0) }));

      await service.contribute('user-1', 'goal-1', { amount: 999999 } as any);

      expect(prisma.goal.update.mock.calls[0][0].data.status).toBe(GoalStatus.ACTIVE);
    });
  });

  describe('list', () => {
    it('meta sem alvo lista com targetAmount null (nao 0)', async () => {
      const { service, prisma } = build();
      prisma.goal.findMany.mockResolvedValue([stored({ targetAmount: null })]);

      const [result] = await service.list('user-1');

      expect(result.targetAmount).toBeNull();
    });
  });

  describe('withdraw', () => {
    it('diminui o saldo guardado e gera uma transacao INCOME (o dinheiro volta pro livre)', async () => {
      const { service, prisma } = build();

      await service.withdraw('user-1', 'goal-1', { amount: 300 } as any);

      expect(Number(prisma.goal.update.mock.calls[0][0].data.currentAmount)).toBe(500);
      expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
        type: TransactionType.INCOME,
        userId: 'user-1',
        linkedGoalId: 'goal-1',
      });
      expect(Number(prisma.transaction.create.mock.calls[0][0].data.amount)).toBe(300);
    });

    it('recusa sacar mais do que tem guardado', async () => {
      const { service, prisma } = build(stored({ currentAmount: decimal(100) }));

      await expect(service.withdraw('user-1', 'goal-1', { amount: 300 } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

    it('sacar exatamente o saldo todo e permitido (zera, nao fica negativo)', async () => {
      const { service, prisma } = build(stored({ currentAmount: decimal(300) }));

      await service.withdraw('user-1', 'goal-1', { amount: 300 } as any);

      expect(Number(prisma.goal.update.mock.calls[0][0].data.currentAmount)).toBe(0);
    });

    it('sacar de uma meta ja concluida que cai abaixo do alvo volta para ATIVA', async () => {
      const { service, prisma } = build(
        stored({ currentAmount: decimal(3000), status: GoalStatus.ACHIEVED }),
      );

      await service.withdraw('user-1', 'goal-1', { amount: 500 } as any);

      expect(prisma.goal.update.mock.calls[0][0].data.status).toBe(GoalStatus.ACTIVE);
    });

    it('sacar um pouco de uma meta concluida sem cair abaixo do alvo continua concluida', async () => {
      // Alvo 3000, guardado 3500 (acima do alvo); sacar 200 ainda deixa 3300 >= 3000.
      const { service, prisma } = build(
        stored({ currentAmount: decimal(3500), status: GoalStatus.ACHIEVED }),
      );

      await service.withdraw('user-1', 'goal-1', { amount: 200 } as any);

      expect(prisma.goal.update.mock.calls[0][0].data.status).toBe(GoalStatus.ACHIEVED);
    });

    it('createTransaction:false nao cria a transacao, so ajusta o saldo', async () => {
      const { service, prisma } = build();

      await service.withdraw('user-1', 'goal-1', { amount: 300, createTransaction: false } as any);

      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('usa a descricao informada, ou uma padrao com o titulo da meta', async () => {
      const { service, prisma } = build();

      await service.withdraw('user-1', 'goal-1', { amount: 100 } as any);
      expect(prisma.transaction.create.mock.calls[0][0].data.description).toBe('Saque da meta Viagem');

      const { service: service2, prisma: prisma2 } = build();
      await service2.withdraw('user-1', 'goal-1', { amount: 100, description: 'Comprei a passagem' } as any);
      expect(prisma2.transaction.create.mock.calls[0][0].data.description).toBe('Comprei a passagem');
    });

    it('recalcula os insights apos o saque', async () => {
      const { service, lifeEngine } = build();

      await service.withdraw('user-1', 'goal-1', { amount: 100 } as any);

      expect(lifeEngine.touchUserData).toHaveBeenCalledWith('user-1');
    });

    it('nao mexe em meta de outro usuario', async () => {
      const { service, prisma } = build(null);

      await expect(service.withdraw('user-1', 'goal-alheia', { amount: 10 } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

    it('sacar de meta sem alvo funciona normalmente (sem crashar no calculo do status)', async () => {
      const { service, prisma } = build(
        stored({ targetAmount: null, currentAmount: decimal(500) }),
      );

      await service.withdraw('user-1', 'goal-1', { amount: 200 } as any);

      expect(Number(prisma.goal.update.mock.calls[0][0].data.currentAmount)).toBe(300);
      expect(prisma.goal.update.mock.calls[0][0].data.status).toBe(GoalStatus.ACTIVE);
    });
  });
});
