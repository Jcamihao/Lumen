import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pickEffectivePlan } from './access.util';
import { BillingService } from './billing.service';

const DAY = 24 * 60 * 60 * 1000;

function usageStub(plan = 'FREE') {
  return {
    enforced: true,
    plan,
    resources: {},
    selahQuestions: { used: 0, limit: 5, resetsAt: '2026-10-01T03:00:00.000Z' },
  };
}

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    ownerUserId: 'user-1',
    plan: 'INDIVIDUAL',
    status: 'ACTIVE',
    source: 'GRANT',
    interval: null,
    seats: 1,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    latestInvoiceUrl: null,
    grantedByUserId: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    owner: { email: 'ana@exemplo.com', name: 'Ana' },
    ...overrides,
  };
}

function build(enforced = true) {
  const prisma = {
    subscription: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    groupMembership: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const entitlements = {
    getUsage: jest.fn().mockResolvedValue(usageStub()),
    // O stub espelha a resolucao propria (mesma funcao pura): os testes de getMe continuam
    // exercitando status/source/currentPeriodEnd a partir das linhas de subscription.
    resolvePlan: jest.fn(async () =>
      pickEffectivePlan(
        (await prisma.subscription.findMany({ where: { ownerUserId: 'stub' } })) as never,
        new Date(),
      ),
    ),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'app.billingEnabled' ? enforced : undefined,
    ),
  };
  const service = new BillingService(
    prisma as any,
    entitlements as any,
    config as unknown as ConfigService,
  );
  return { prisma, entitlements, config, service };
}

describe('BillingService', () => {
  describe('getPlans', () => {
    it('devolve os 3 planos e enabled conforme o config', () => {
      const on = build(true).service.getPlans();
      expect(on.enabled).toBe(true);
      expect(on.plans.map((p) => p.id)).toEqual(['FREE', 'INDIVIDUAL', 'SHARED']);
      expect(on.plans[1]).toMatchObject({
        label: 'Individual',
        sellable: true,
        seats: 1,
        selahQuestionsPerMonth: 300,
        prices: { MONTHLY: 14.9, YEARLY: 149 },
      });
      expect(on.plans[0].prices).toBeNull();
      expect(build(false).service.getPlans().enabled).toBe(false);
    });
  });

  describe('getMe', () => {
    it('sem assinaturas: FREE, status/source nulos', async () => {
      const { service } = build();
      const me = await service.getMe('user-1');
      expect(me).toMatchObject({
        enabled: true,
        plan: 'FREE',
        status: null,
        source: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        latestInvoiceUrl: null,
      });
      expect(me.usage.plan).toBe('FREE');
    });

    it('concessão ativa: INDIVIDUAL com source GRANT', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([subRow()]);
      const me = await service.getMe('user-1');
      expect(me).toMatchObject({
        plan: 'INDIVIDUAL',
        status: 'ACTIVE',
        source: 'GRANT',
        currentPeriodEnd: null,
        latestInvoiceUrl: null,
      });
    });

    it('assinatura efetiva com latestInvoiceUrl gravado: getMe devolve esse valor', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([
        subRow({
          source: 'ASAAS',
          status: 'PAST_DUE',
          latestInvoiceUrl: 'https://sandbox.asaas.com/i/pay-1',
        }),
      ]);
      const me = await service.getMe('user-1');
      expect(me.plan).toBe('INDIVIDUAL');
      expect(me.latestInvoiceUrl).toBe('https://sandbox.asaas.com/i/pay-1');
    });

    it('concessão vencida há 10 dias (sem tolerância): FREE', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([
        subRow({ currentPeriodEnd: new Date(Date.now() - 10 * DAY) }),
      ]);
      const me = await service.getMe('user-1');
      expect(me.plan).toBe('FREE');
      expect(me.status).toBeNull();
      expect(me.source).toBeNull();
    });

    it('concessão + assinatura paga: vence o maior plano', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([
        subRow(),
        subRow({
          id: 'sub-2',
          plan: 'SHARED',
          source: 'ASAAS',
          currentPeriodEnd: new Date(Date.now() + 20 * DAY),
        }),
      ]);
      const me = await service.getMe('user-1');
      expect(me.plan).toBe('SHARED');
      expect(me.source).toBe('ASAAS');
      expect(me.currentPeriodEnd).not.toBeNull();
    });

    it('sem grupo e sem SHARED proprio: group e null', async () => {
      const { service } = build();
      const me = await service.getMe('user-1');
      expect(me.group).toBeNull();
    });

    it('pagador com SHARED proprio ativo: group owner (mesmo sem membros)', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([
        subRow({ plan: 'SHARED', source: 'ASAAS', currentPeriodEnd: new Date(Date.now() + 10 * DAY) }),
      ]);
      const me = await service.getMe('user-1');
      expect(me.plan).toBe('SHARED');
      expect(me.group).toEqual({ role: 'owner', ownerFirstName: null });
    });

    it('membro: plan vem do grupo, status de cobranca seguem nulos e so o primeiro nome do pagador aparece (D10)', async () => {
      const { service, prisma, entitlements } = build();
      entitlements.resolvePlan.mockResolvedValue('SHARED');
      prisma.groupMembership.findFirst.mockResolvedValue({
        owner: { name: '  Ana Beatriz Souza' },
      });
      const me = await service.getMe('user-1');
      expect(me).toMatchObject({
        plan: 'SHARED',
        status: null,
        source: null,
        currentPeriodEnd: null,
        latestInvoiceUrl: null,
        group: { role: 'member', ownerFirstName: 'Ana' },
      });
    });

    it('pagador com SHARED vencido mas membros ativos ainda e owner (para poder reassinar)', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([
        subRow({ plan: 'SHARED', source: 'ASAAS', status: 'EXPIRED', currentPeriodEnd: new Date(Date.now() - 10 * DAY) }),
      ]);
      prisma.groupMembership.count.mockResolvedValue(1);
      const me = await service.getMe('user-1');
      expect(me.plan).toBe('FREE');
      expect(me.group).toEqual({ role: 'owner', ownerFirstName: null });
    });

    it('nome do pagador sem primeiro nome aproveitavel: ownerFirstName null', async () => {
      const { service, prisma, entitlements } = build();
      entitlements.resolvePlan.mockResolvedValue('SHARED');
      prisma.groupMembership.findFirst.mockResolvedValue({ owner: { name: '   ' } });
      const me = await service.getMe('user-1');
      expect(me.group).toEqual({ role: 'member', ownerFirstName: null });
    });
  });

  describe('createGrant', () => {
    it('normaliza o e-mail (trim + minúsculas) e cria a concessão', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'ana@exemplo.com',
        name: 'Ana',
      });
      prisma.subscription.create.mockResolvedValue(subRow());

      const view = await service.createGrant('admin-1', {
        email: '  Ana@Exemplo.COM ',
        plan: 'INDIVIDUAL',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ana@exemplo.com' },
        select: { id: true, email: true, name: true },
      });
      const args = prisma.subscription.create.mock.calls[0][0];
      expect(args.data).toMatchObject({
        ownerUserId: 'user-1',
        plan: 'INDIVIDUAL',
        source: 'GRANT',
        status: 'ACTIVE',
        grantedByUserId: 'admin-1',
        currentPeriodEnd: null,
      });
      expect(view).toMatchObject({
        id: 'sub-1',
        email: 'ana@exemplo.com',
        name: 'Ana',
        plan: 'INDIVIDUAL',
        status: 'ACTIVE',
        currentPeriodEnd: null,
      });
    });

    it('grava currentPeriodEnd quando endsAt é informado', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', name: 'A' });
      prisma.subscription.create.mockResolvedValue(subRow());
      await service.createGrant('admin-1', {
        email: 'a@b.com',
        plan: 'INDIVIDUAL',
        endsAt: '2027-01-31T00:00:00.000Z',
      });
      expect(prisma.subscription.create.mock.calls[0][0].data.currentPeriodEnd).toEqual(
        new Date('2027-01-31T00:00:00.000Z'),
      );
    });

    it('e-mail inexistente: NotFoundException', async () => {
      const { service, prisma } = build();
      await expect(
        service.createGrant('admin-1', { email: 'x@y.com', plan: 'INDIVIDUAL' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('já há concessão ativa do mesmo plano: BadRequestException', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', name: 'A' });
      prisma.subscription.findFirst.mockResolvedValue(subRow());
      await expect(
        service.createGrant('admin-1', { email: 'a@b.com', plan: 'INDIVIDUAL' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      const where = prisma.subscription.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({
        ownerUserId: 'user-1',
        source: 'GRANT',
        plan: 'INDIVIDUAL',
        status: 'ACTIVE',
      });
    });

    it('endsAt no passado: BadRequestException', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', name: 'A' });
      await expect(
        service.createGrant('admin-1', {
          email: 'a@b.com',
          plan: 'INDIVIDUAL',
          endsAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('revokeGrant', () => {
    it('marca CANCELED com currentPeriodEnd = agora', async () => {
      const { service, prisma } = build();
      prisma.subscription.findUnique.mockResolvedValue(subRow());
      prisma.subscription.update.mockImplementation(({ data }: any) =>
        Promise.resolve(subRow(data)),
      );
      const before = Date.now();
      const view = await service.revokeGrant('sub-1');
      const args = prisma.subscription.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'sub-1' });
      expect(args.data.status).toBe('CANCELED');
      expect(args.data.currentPeriodEnd.getTime()).toBeGreaterThanOrEqual(before);
      expect(view.status).toBe('CANCELED');
    });

    it('chamar duas vezes não falha e não altera o registro já cancelado', async () => {
      const { service, prisma } = build();
      const ended = new Date('2026-09-20T00:00:00.000Z');
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ status: 'CANCELED', currentPeriodEnd: ended }),
      );
      const view = await service.revokeGrant('sub-1');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(view.status).toBe('CANCELED');
      expect(view.currentPeriodEnd).toBe(ended.toISOString());
    });

    it('id inexistente ou que não é GRANT: NotFoundException', async () => {
      const { service, prisma } = build();
      await expect(service.revokeGrant('nope')).rejects.toBeInstanceOf(NotFoundException);
      prisma.subscription.findUnique.mockResolvedValue(subRow({ source: 'ASAAS' }));
      await expect(service.revokeGrant('sub-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('listGrants', () => {
    it('lista só concessões com e-mail e nome do dono', async () => {
      const { service, prisma } = build();
      prisma.subscription.findMany.mockResolvedValue([subRow()]);
      const list = await service.listGrants();
      expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({ source: 'GRANT' });
      expect(list).toEqual([
        expect.objectContaining({ id: 'sub-1', email: 'ana@exemplo.com', name: 'Ana' }),
      ]);
    });
  });
});
