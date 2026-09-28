import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPaymentsService } from './billing-payments.service';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const MIN = 60 * 1000;
const WEBHOOK_TOKEN = 'whsec_test_token_123';

function billingEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    provider: 'ASAAS',
    externalEventId: 'evt-1',
    type: 'CHECKOUT_PAID',
    payload: {},
    processedAt: null,
    error: null,
    createdAt: NOW,
    ...overrides,
  };
}

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    ownerUserId: 'user-1',
    plan: 'INDIVIDUAL',
    status: 'ACTIVE',
    source: 'ASAAS',
    interval: 'MONTHLY',
    seats: 1,
    currentPeriodEnd: null,
    pastDueSince: null,
    cancelAtPeriodEnd: false,
    asaasCheckoutId: null,
    asaasCheckoutLink: null,
    asaasSubscriptionId: null,
    asaasCustomerId: null,
    latestInvoiceUrl: null,
    grantedByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function build(overrides: { enabled?: boolean } = {}) {
  const prisma = {
    subscription: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(subRow({ id: 'sub-new', status: 'PENDING' })),
      update: jest.fn().mockResolvedValue(subRow({ id: 'sub-new', status: 'PENDING' })),
    },
    billingEvent: {
      create: jest.fn().mockResolvedValue(billingEventRow()),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(billingEventRow({ processedAt: NOW })),
    },
  };
  const asaasClient = {
    createCheckout: jest
      .fn()
      .mockResolvedValue({ id: 'asaas-checkout-1', link: 'https://asaas.test/c/1' }),
    getSubscription: jest.fn(),
    findSubscriptionByExternalReference: jest.fn(),
    deleteSubscription: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'app.billingEnabled') return overrides.enabled ?? true;
      if (key === 'app.frontendUrl') return 'https://lumen.test';
      if (key === 'asaas.webhookToken') return WEBHOOK_TOKEN;
      return undefined;
    }),
  };
  const service = new BillingPaymentsService(
    prisma as any,
    asaasClient as any,
    config as unknown as ConfigService,
  );
  return { prisma, asaasClient, config, service };
}

describe('BillingPaymentsService#checkout', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejeita quando o billing esta desligado, sem chamar o Asaas', async () => {
    const { service, asaasClient } = build({ enabled: false });

    await expect(
      service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(asaasClient.createCheckout).not.toHaveBeenCalled();
  });

  it('rejeita plano nao vendavel (SHARED), sem chamar o Asaas', async () => {
    const { service, asaasClient } = build();

    await expect(
      service.checkout('user-1', { plan: 'SHARED', interval: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(asaasClient.createCheckout).not.toHaveBeenCalled();
  });

  it('rejeita quando ja existe Subscription ACTIVE (ASAAS) de plano igual', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findMany.mockResolvedValue([
      subRow({ status: 'ACTIVE', source: 'ASAAS', plan: 'INDIVIDUAL' }),
    ]);

    await expect(
      service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(asaasClient.createCheckout).not.toHaveBeenCalled();
  });

  it('rejeita quando ja existe Subscription PAST_DUE (ASAAS) de plano igual', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findMany.mockResolvedValue([
      subRow({ status: 'PAST_DUE', source: 'ASAAS', plan: 'INDIVIDUAL' }),
    ]);

    await expect(
      service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(asaasClient.createCheckout).not.toHaveBeenCalled();
  });

  it('rejeita quando ja existe concessao GRANT ACTIVE de plano igual ou maior', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findMany.mockResolvedValue([
      subRow({ status: 'ACTIVE', source: 'GRANT', plan: 'SHARED' }),
    ]);

    await expect(
      service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(asaasClient.createCheckout).not.toHaveBeenCalled();
  });

  it('NAO rejeita Subscription CANCELED (ainda com acesso) — segue para o checkout normal', async () => {
    const { service, prisma, asaasClient } = build();
    // A query de bloqueio so busca ACTIVE/PAST_DUE: uma linha CANCELED nunca aparece aqui.
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.subscription.findFirst.mockResolvedValue(null);

    const result = await service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' });

    expect(result).toEqual({ link: 'https://asaas.test/c/1' });
    expect(asaasClient.createCheckout).toHaveBeenCalledTimes(1);
  });

  it('reaproveita checkout PENDING recente (10min) com link — nao chama o Asaas', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.subscription.findFirst.mockResolvedValue(
      subRow({
        status: 'PENDING',
        source: 'ASAAS',
        asaasCheckoutLink: 'https://asaas.test/c/reuse',
        createdAt: new Date(NOW.getTime() - 10 * MIN),
      }),
    );

    const result = await service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' });

    expect(result).toEqual({ link: 'https://asaas.test/c/reuse' });
    expect(asaasClient.createCheckout).not.toHaveBeenCalled();
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('checkout PENDING expirado (90min, > 60 de minutesToExpire) nao e reaproveitado — cria um novo', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findMany.mockResolvedValue([]);
    // A query real filtra por createdAt > cutoff; uma linha de 90min atras nunca bate, entao o
    // findFirst simulado devolve null (mesmo efeito de "nao achou nada reaproveitavel").
    prisma.subscription.findFirst.mockResolvedValue(null);

    const result = await service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' });

    expect(asaasClient.createCheckout).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ link: 'https://asaas.test/c/1' });
  });

  it('caminho feliz: cria Subscription PENDING, chama createCheckout com externalReference/value do catalogo e grava o link', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.subscription.create.mockResolvedValue(subRow({ id: 'sub-new', status: 'PENDING' }));

    const result = await service.checkout('user-1', { plan: 'INDIVIDUAL', interval: 'MONTHLY' });

    expect(prisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: 'user-1',
        plan: 'INDIVIDUAL',
        status: 'PENDING',
        source: 'ASAAS',
        interval: 'MONTHLY',
      }),
    });
    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 14.9,
        cycle: 'MONTHLY',
        externalReference: 'sub-new',
        minutesToExpire: 60,
      }),
    );
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-new' },
      data: { asaasCheckoutId: 'asaas-checkout-1', asaasCheckoutLink: 'https://asaas.test/c/1' },
    });
    expect(result).toEqual({ link: 'https://asaas.test/c/1' });
  });
});

describe('BillingPaymentsService#processWebhookEvent', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sem header, ou header diferente do token configurado, rejeita com UnauthorizedException sem gravar nada', async () => {
    const { service, prisma, asaasClient } = build();

    await expect(
      service.processWebhookEvent(undefined, { id: 'evt-1', event: 'CHECKOUT_PAID' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.processWebhookEvent('token-errado', { id: 'evt-1', event: 'CHECKOUT_PAID' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.billingEvent.create).not.toHaveBeenCalled();
    expect(asaasClient.getSubscription).not.toHaveBeenCalled();
  });

  it('payload sem id ou sem event (string) rejeita com BadRequestException', async () => {
    const { service, prisma } = build();

    await expect(
      service.processWebhookEvent(WEBHOOK_TOKEN, { event: 'CHECKOUT_PAID' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.processWebhookEvent(WEBHOOK_TOKEN, { id: 'evt-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.processWebhookEvent(WEBHOOK_TOKEN, { id: 'evt-1', event: 42 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.billingEvent.create).not.toHaveBeenCalled();
  });

  it('evento ja existente com processedAt preenchido devolve sem reprocessar', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.billingEvent.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    prisma.billingEvent.findUnique.mockResolvedValue(billingEventRow({ processedAt: NOW }));

    await expect(
      service.processWebhookEvent(WEBHOOK_TOKEN, { id: 'evt-1', event: 'CHECKOUT_PAID' }),
    ).resolves.toBeUndefined();

    expect(asaasClient.getSubscription).not.toHaveBeenCalled();
    expect(prisma.billingEvent.update).not.toHaveBeenCalled();
  });

  it('CHECKOUT_PAID com checkout.id conhecido grava os ids do Asaas e ativa a assinatura', async () => {
    const { service, prisma, asaasClient } = build();
    const local = subRow({
      id: 'sub-1',
      status: 'PENDING',
      source: 'ASAAS',
      asaasCheckoutId: 'checkout-1',
      asaasSubscriptionId: null,
      asaasCustomerId: null,
      currentPeriodEnd: null,
      pastDueSince: null,
    });
    prisma.subscription.findFirst.mockResolvedValue(local);
    asaasClient.getSubscription.mockResolvedValue({
      id: 'asaas-sub-1',
      deleted: false,
      nextDueDate: '2026-10-28',
      externalReference: local.id,
    });

    await service.processWebhookEvent(WEBHOOK_TOKEN, {
      id: 'evt-1',
      event: 'CHECKOUT_PAID',
      checkout: { id: 'checkout-1', subscription: 'asaas-sub-1', customer: 'cus-1' },
    });

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { asaasCheckoutId: 'checkout-1' },
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { asaasSubscriptionId: 'asaas-sub-1', asaasCustomerId: 'cus-1' },
    });
    expect(asaasClient.getSubscription).toHaveBeenCalledWith('asaas-sub-1');
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-10-28'),
        pastDueSince: null,
      },
    });
    expect(prisma.billingEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: NOW },
    });
  });

  it('CHECKOUT_PAID com checkout.id desconhecido nao lanca erro e nao chama o Asaas', async () => {
    const { service, prisma, asaasClient } = build();
    prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(
      service.processWebhookEvent(WEBHOOK_TOKEN, {
        id: 'evt-1',
        event: 'CHECKOUT_PAID',
        checkout: { id: 'checkout-orfao' },
      }),
    ).resolves.toBeUndefined();

    expect(asaasClient.getSubscription).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.billingEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: NOW },
    });
  });

  it('evento de tipo desconhecido (ex. SPLIT_CREATED) nao lanca erro e nao toca em Subscription', async () => {
    const { service, prisma, asaasClient } = build();

    await expect(
      service.processWebhookEvent(WEBHOOK_TOKEN, { id: 'evt-1', event: 'SPLIT_CREATED' }),
    ).resolves.toBeUndefined();

    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(asaasClient.getSubscription).not.toHaveBeenCalled();
    expect(prisma.billingEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: NOW },
    });
  });
});
