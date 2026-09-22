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
  });
});
