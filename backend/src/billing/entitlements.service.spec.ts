import { ConfigService } from '@nestjs/config';
import { EntitlementsService } from './entitlements.service';
import { PlanLimitException } from './plan-limit.exception';
import { currentMonthWindow } from './access.util';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function makePrisma() {
  return {
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
    groupMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    goal: { count: jest.fn().mockResolvedValue(0) },
    envelope: { count: jest.fn().mockResolvedValue(0) },
    recurringTransaction: { count: jest.fn().mockResolvedValue(0) },
    installmentPurchase: { count: jest.fn().mockResolvedValue(0) },
    creditCard: { count: jest.fn().mockResolvedValue(0) },
    selahUsage: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function build(enforced: boolean) {
  const prisma = makePrisma();
  const config = {
    get: jest.fn((key: string) =>
      key === 'app.billingEnabled' ? enforced : undefined,
    ),
  };
  const service = new EntitlementsService(
    prisma as any,
    config as unknown as ConfigService,
  );
  return { prisma, config, service };
}

function paidSub(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'INDIVIDUAL',
    status: 'ACTIVE',
    source: 'ASAAS',
    currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY),
    ...overrides,
  };
}

async function limitError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return e as PlanLimitException;
  }
  throw new Error('esperava PlanLimitException');
}

describe('EntitlementsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('interruptor desligado', () => {
    it('assertCanCreate e assertCanAskSelah resolvem sem tocar no banco', async () => {
      const { prisma, service } = build(false);
      await expect(service.assertCanCreate('u1', 'goals')).resolves.toBeUndefined();
      await expect(service.assertCanAskSelah('u1')).resolves.toBeUndefined();
      for (const model of Object.values(prisma)) {
        for (const fn of Object.values(model)) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('assertCanCreate (ligado)', () => {
    it('FREE com metas 2/2 rejeita com PlanLimitException', async () => {
      const { prisma, service } = build(true);
      prisma.goal.count.mockResolvedValue(2);
      const err = await limitError(service.assertCanCreate('u1', 'goals'));
      expect(err).toBeInstanceOf(PlanLimitException);
      expect(err.getResponse()).toMatchObject({
        code: 'PLAN_LIMIT',
        resource: 'goals',
        limit: 2,
        used: 2,
        plan: 'FREE',
      });
    });

    it('FREE com metas 1/2 resolve', async () => {
      const { prisma, service } = build(true);
      prisma.goal.count.mockResolvedValue(1);
      await expect(service.assertCanCreate('u1', 'goals')).resolves.toBeUndefined();
    });

    it('conta metas filtrando userId e status ACTIVE', async () => {
      const { prisma, service } = build(true);
      await service.assertCanCreate('u1', 'goals');
      expect(prisma.goal.count).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'ACTIVE' },
      });
    });

    it.each([
      ['envelopes', 'envelope'],
      ['recurringTransactions', 'recurringTransaction'],
      ['installmentPurchases', 'installmentPurchase'],
    ] as const)('conta %s filtrando userId e isActive', async (resource, model) => {
      const { prisma, service } = build(true);
      await service.assertCanCreate('u1', resource);
      expect(prisma[model].count).toHaveBeenCalledWith({
        where: { userId: 'u1', isActive: true },
      });
    });

    it('INDIVIDUAL ativo com 50 metas resolve (sem limite)', async () => {
      const { prisma, service } = build(true);
      prisma.subscription.findMany.mockResolvedValue([paidSub()]);
      prisma.goal.count.mockResolvedValue(50);
      await expect(service.assertCanCreate('u1', 'goals')).resolves.toBeUndefined();
    });

    it('resolvePlan busca linhas inteiras da assinatura do dono', async () => {
      const { prisma, service } = build(true);
      await service.resolvePlan('u1');
      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: { ownerUserId: 'u1' },
      });
    });

    it('sem membership nao procura grupo nem assinatura alheia', async () => {
      const { prisma, service } = build(true);
      await service.resolvePlan('u1');
      expect(prisma.groupMembership.findFirst).toHaveBeenCalledWith({
        where: { memberUserId: 'u1', leftAt: null },
      });
      expect(prisma.subscription.findMany).toHaveBeenCalledTimes(1);
    });

    describe('resolvePlan com grupo (contrato 11, D6/D11)', () => {
      const membership = (overrides: Record<string, unknown> = {}) => ({
        id: 'm-1',
        ownerUserId: 'owner-1',
        memberUserId: 'u1',
        leftAt: null,
        ...overrides,
      });
      const sharedOf = (overrides: Record<string, unknown> = {}) =>
        paidSub({ plan: 'SHARED', ...overrides });

      it('membro de pagador com SHARED ativo resolve SHARED', async () => {
        const { prisma, service } = build(true);
        prisma.groupMembership.findFirst.mockResolvedValue(membership());
        prisma.subscription.findMany.mockImplementation(({ where }: any) =>
          Promise.resolve(where.plan === 'SHARED' ? [sharedOf()] : []),
        );
        await expect(service.resolvePlan('u1')).resolves.toBe('SHARED');
      });

      it('busca do pagador so traz linhas SHARED (INDIVIDUAL dele nao empresta plano)', async () => {
        const { prisma, service } = build(true);
        prisma.groupMembership.findFirst.mockResolvedValue(membership());
        prisma.subscription.findMany.mockImplementation(({ where }: any) =>
          Promise.resolve(where.plan === 'SHARED' ? [sharedOf()] : []),
        );
        await service.resolvePlan('u1');
        expect(prisma.subscription.findMany).toHaveBeenLastCalledWith({
          where: { ownerUserId: 'owner-1', plan: 'SHARED' },
        });
      });

      it('SHARED do pagador vencido: membro resolve FREE (todo o grupo cai junto, D11)', async () => {
        const { prisma, service } = build(true);
        prisma.groupMembership.findFirst.mockResolvedValue(membership());
        prisma.subscription.findMany.mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.plan === 'SHARED'
              ? [sharedOf({ currentPeriodEnd: new Date(NOW.getTime() - 8 * DAY) })]
              : [],
          ),
        );
        await expect(service.resolvePlan('u1')).resolves.toBe('FREE');
      });

      it('dois caminhos ativos: proprio INDIVIDUAL + SHARED do grupo, vence o maior (PLAN_RANK)', async () => {
        const { prisma, service } = build(true);
        prisma.groupMembership.findFirst.mockResolvedValue(membership());
        prisma.subscription.findMany.mockImplementation(({ where }: any) =>
          Promise.resolve(where.plan === 'SHARED' ? [sharedOf()] : [paidSub()]),
        );
        await expect(service.resolvePlan('u1')).resolves.toBe('SHARED');
      });

      it('membro com SHARED do grupo usa o limite de 10 cartoes', async () => {
        const { prisma, service } = build(true);
        prisma.groupMembership.findFirst.mockResolvedValue(membership());
        prisma.subscription.findMany.mockImplementation(({ where }: any) =>
          Promise.resolve(where.plan === 'SHARED' ? [sharedOf()] : []),
        );
        prisma.creditCard.count.mockResolvedValue(10);
        const err = await limitError(service.assertCanCreate('u1', 'creditCards'));
        expect(err.getResponse()).toMatchObject({ limit: 10, used: 10, plan: 'SHARED' });
      });
    });

    describe('cartoes por plano (D7)', () => {
      it('FREE com 1 cartao rejeita o segundo', async () => {
        const { prisma, service } = build(true);
        prisma.creditCard.count.mockResolvedValue(1);
        const err = await limitError(service.assertCanCreate('u1', 'creditCards'));
        expect(err.getResponse()).toMatchObject({
          code: 'PLAN_LIMIT',
          resource: 'creditCards',
          limit: 1,
          plan: 'FREE',
        });
        expect((err.getResponse() as any).message).toContain('cartões ativos');
      });

      it('INDIVIDUAL libera ate 5 e rejeita no 6o', async () => {
        const { prisma, service } = build(true);
        prisma.subscription.findMany.mockResolvedValue([paidSub()]);
        prisma.creditCard.count.mockResolvedValue(4);
        await expect(service.assertCanCreate('u1', 'creditCards')).resolves.toBeUndefined();
        prisma.creditCard.count.mockResolvedValue(5);
        const err = await limitError(service.assertCanCreate('u1', 'creditCards'));
        expect(err.getResponse()).toMatchObject({ limit: 5, plan: 'INDIVIDUAL' });
      });

      it('SHARED libera ate 10 (o teto tecnico do 9a virou limite do plano)', async () => {
        const { prisma, service } = build(true);
        prisma.subscription.findMany.mockResolvedValue([paidSub({ plan: 'SHARED' })]);
        prisma.creditCard.count.mockResolvedValue(9);
        await expect(service.assertCanCreate('u1', 'creditCards')).resolves.toBeUndefined();
        prisma.creditCard.count.mockResolvedValue(10);
        await expect(service.assertCanCreate('u1', 'creditCards')).rejects.toBeInstanceOf(
          PlanLimitException,
        );
      });

      it('conta cartoes filtrando userId e archivedAt nulo', async () => {
        const { prisma, service } = build(true);
        await service.assertCanCreate('u1', 'creditCards');
        expect(prisma.creditCard.count).toHaveBeenCalledWith({
          where: { userId: 'u1', archivedAt: null },
        });
      });
    });

    it('concessão vencida há 2 dias (sem outra assinatura) cai nos limites FREE', async () => {
      const { prisma, service } = build(true);
      prisma.subscription.findMany.mockResolvedValue([
        paidSub({ source: 'GRANT', currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY) }),
      ]);
      prisma.goal.count.mockResolvedValue(2);
      const err = await limitError(service.assertCanCreate('u1', 'goals'));
      expect(err.getResponse()).toMatchObject({ plan: 'FREE', limit: 2, used: 2 });
    });
  });

  describe('Selah', () => {
    const window = currentMonthWindow(NOW);

    it('conta com createdAt na janela do mês e rejeita em 5/5 no FREE', async () => {
      const { prisma, service } = build(true);
      prisma.selahUsage.count.mockResolvedValue(5);
      const err = await limitError(service.assertCanAskSelah('u1'));
      expect(err.getResponse()).toMatchObject({
        code: 'PLAN_LIMIT',
        resource: 'selahQuestions',
        limit: 5,
        used: 5,
        plan: 'FREE',
      });
      expect(prisma.selahUsage.count).toHaveBeenCalledWith({
        where: { userId: 'u1', createdAt: { gte: window.start, lt: window.end } },
      });
    });

    it('FREE com 4/5 resolve', async () => {
      const { prisma, service } = build(true);
      prisma.selahUsage.count.mockResolvedValue(4);
      await expect(service.assertCanAskSelah('u1')).resolves.toBeUndefined();
    });

    it('INDIVIDUAL com 299/300 resolve e com 300/300 rejeita', async () => {
      const { prisma, service } = build(true);
      prisma.subscription.findMany.mockResolvedValue([paidSub()]);
      prisma.selahUsage.count.mockResolvedValue(299);
      await expect(service.assertCanAskSelah('u1')).resolves.toBeUndefined();
      prisma.selahUsage.count.mockResolvedValue(300);
      const err = await limitError(service.assertCanAskSelah('u1'));
      expect(err.getResponse()).toMatchObject({ limit: 300, used: 300, plan: 'INDIVIDUAL' });
    });
  });

  describe('recordSelahQuestion', () => {
    it.each([true, false])('grava selahUsage com o interruptor=%s', async (enforced) => {
      const { prisma, service } = build(enforced);
      await service.recordSelahQuestion('u1');
      expect(prisma.selahUsage.create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
    });
  });

  describe('getUsage', () => {
    it('com o interruptor desligado devolve enforced:false, plano real e contagens', async () => {
      const { prisma, service } = build(false);
      prisma.subscription.findMany.mockResolvedValue([paidSub()]);
      prisma.goal.count.mockResolvedValue(7);
      prisma.envelope.count.mockResolvedValue(3);
      prisma.recurringTransaction.count.mockResolvedValue(4);
      prisma.installmentPurchase.count.mockResolvedValue(1);
      prisma.creditCard.count.mockResolvedValue(2);
      prisma.selahUsage.count.mockResolvedValue(12);

      const usage = await service.getUsage('u1');

      expect(usage).toEqual({
        enforced: false,
        plan: 'INDIVIDUAL',
        resources: {
          goals: { used: 7, limit: null },
          envelopes: { used: 3, limit: null },
          recurringTransactions: { used: 4, limit: null },
          installmentPurchases: { used: 1, limit: null },
          creditCards: { used: 2, limit: 5 },
        },
        selahQuestions: {
          used: 12,
          limit: 300,
          resetsAt: currentMonthWindow(NOW).end.toISOString(),
        },
      });
    });

    it('FREE ligado mostra limites do plano gratuito', async () => {
      const { service } = build(true);
      const usage = await service.getUsage('u1');
      expect(usage.enforced).toBe(true);
      expect(usage.plan).toBe('FREE');
      expect(usage.resources.goals).toEqual({ used: 0, limit: 2 });
      expect(usage.selahQuestions.limit).toBe(5);
    });
  });
});
