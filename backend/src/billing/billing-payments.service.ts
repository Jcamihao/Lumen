import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient } from './asaas-client';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { getCatalog, PLAN_RANK } from './plans.catalog';

// Mesma janela usada no checkout `RECURRENT` do Asaas (Global Constraints do plano):
// depois disso o checkout expira do lado deles e nao pode mais ser reaproveitado.
const CHECKOUT_MINUTES_TO_EXPIRE = 60;

// Chaves conhecidas que o Asaas pode um dia embutir no payload do webhook e que
// nunca podem ir pro banco (CPF nem dado de cartao) — hoje os payloads confirmados
// no spike nao as tem, mas a sanitizacao protege se o Asaas enriquecer depois.
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'creditCard',
  'creditCardHolderInfo',
  'cpfCnpj',
  'postalCode',
  'address',
  'addressNumber',
  'phoneNumber',
]);

function sanitizeWebhookPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWebhookPayload(item));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_PAYLOAD_KEYS.has(key)) {
        continue;
      }
      result[key] = sanitizeWebhookPayload(val);
    }
    return result;
  }
  return value;
}

/** Violacao do indice unico (`BillingEvent.externalEventId`): o evento ja foi gravado antes. */
function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002';
}

@Injectable()
export class BillingPaymentsService {
  private readonly logger = new Logger(BillingPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasClient: AsaasClient,
    private readonly configService: ConfigService,
  ) {}

  private isEnabled(): boolean {
    return this.configService.get<boolean>('app.billingEnabled') === true;
  }

  private frontendUrl(): string {
    return this.configService.get<string>('app.frontendUrl') ?? '';
  }

  async checkout(
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<{ link: string }> {
    if (!this.isEnabled()) {
      throw new BadRequestException('A cobranca esta desativada no momento.');
    }

    const planDefinition = getCatalog()[dto.plan];
    if (!planDefinition.sellable) {
      throw new BadRequestException(
        'Esse plano nao esta disponivel para assinatura.',
      );
    }

    const price = planDefinition.prices?.[dto.interval];
    if (price === undefined) {
      throw new BadRequestException(
        'Preco indisponivel para esse plano/intervalo.',
      );
    }

    // 1) Qualquer Subscription (Asaas ou concessao) ja em cobranca/acesso com
    // plano de rank igual ou maior bloqueia — nao da pra ter duas ativas.
    const blocking = await this.prisma.subscription.findMany({
      where: { ownerUserId: userId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    });
    const hasBlockingSubscription = blocking.some(
      (sub) => PLAN_RANK[sub.plan] >= PLAN_RANK[dto.plan],
    );
    if (hasBlockingSubscription) {
      throw new BadRequestException(
        'Voce ja tem uma assinatura ativa; cancele antes de trocar.',
      );
    }

    // 2) Checkout PENDING ainda nao expirado (source ASAAS) — reaproveita em
    // vez de abrir outro checkout orfao no Asaas.
    const cutoff = new Date(
      Date.now() - CHECKOUT_MINUTES_TO_EXPIRE * 60_000,
    );
    const reusable = await this.prisma.subscription.findFirst({
      where: {
        ownerUserId: userId,
        source: 'ASAAS',
        status: 'PENDING',
        asaasCheckoutLink: { not: null },
        createdAt: { gt: cutoff },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable?.asaasCheckoutLink) {
      return { link: reusable.asaasCheckoutLink };
    }

    // 3) Nada reaproveitavel: cria a Subscription PENDING primeiro (seu id vira
    // o externalReference do checkout) e so depois chama o Asaas.
    const created = await this.prisma.subscription.create({
      data: {
        ownerUserId: userId,
        plan: dto.plan,
        status: 'PENDING',
        source: 'ASAAS',
        interval: dto.interval,
        seats: planDefinition.seats,
      },
    });

    const frontendUrl = this.frontendUrl();
    const checkout = await this.asaasClient.createCheckout({
      value: price,
      cycle: dto.interval,
      externalReference: created.id,
      successUrl: `${frontendUrl}/plano?checkout=sucesso`,
      cancelUrl: `${frontendUrl}/plano?checkout=cancelado`,
      expiredUrl: `${frontendUrl}/plano?checkout=expirado`,
      minutesToExpire: CHECKOUT_MINUTES_TO_EXPIRE,
    });

    await this.prisma.subscription.update({
      where: { id: created.id },
      data: {
        asaasCheckoutId: checkout.id,
        asaasCheckoutLink: checkout.link,
      },
    });

    return { link: checkout.link };
  }

  /**
   * Recebe um evento de webhook do Asaas: token, idempotencia e dispatch.
   * Lanca antes de gravar qualquer coisa quando o token e invalido; lanca
   * depois de gravar (sem `processedAt`) quando o dispatch falha — o Asaas
   * reenvia e a proxima chamada tenta reprocessar em vez de criar de novo.
   */
  async processWebhookEvent(
    token: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isValidWebhookToken(token)) {
      throw new UnauthorizedException('Token de webhook invalido.');
    }

    const externalEventId = payload.id;
    const eventType = payload.event;
    if (typeof externalEventId !== 'string' || typeof eventType !== 'string') {
      throw new BadRequestException('Payload de webhook invalido.');
    }

    const sanitized = sanitizeWebhookPayload(payload) as Record<string, unknown>;

    let eventId: string;
    try {
      const created = await this.prisma.billingEvent.create({
        data: {
          externalEventId,
          type: eventType,
          payload: sanitized as Prisma.InputJsonValue,
        },
      });
      eventId = created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.prisma.billingEvent.findUnique({
        where: { externalEventId },
      });
      if (!existing) {
        throw error;
      }
      if (existing.processedAt) {
        return;
      }
      eventId = existing.id;
    }

    await this.dispatchWebhookEvent(eventType, sanitized);

    await this.prisma.billingEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date() },
    });
  }

  private isValidWebhookToken(token: string | undefined): boolean {
    const configured = this.configService.get<string>('asaas.webhookToken') ?? '';
    const expected = Buffer.from(configured);
    const received = Buffer.from(token ?? '');

    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private async dispatchWebhookEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case 'CHECKOUT_PAID':
        await this.handleCheckoutPaid(payload);
        break;
      default:
        this.logger.warn(`Evento de webhook do Asaas nao tratado: ${eventType}`);
    }
  }

  private async handleCheckoutPaid(payload: Record<string, unknown>): Promise<void> {
    const checkout = payload.checkout as Record<string, unknown> | undefined;
    const checkoutId = typeof checkout?.id === 'string' ? checkout.id : undefined;
    if (!checkoutId) {
      this.logger.warn('Webhook CHECKOUT_PAID sem checkout.id.');
      return;
    }

    const local = await this.prisma.subscription.findFirst({
      where: { asaasCheckoutId: checkoutId },
    });
    if (!local) {
      this.logger.warn(
        `Webhook CHECKOUT_PAID sem Subscription local para o checkout ${checkoutId}.`,
      );
      return;
    }

    const asaasSubscriptionId =
      typeof checkout?.subscription === 'string' ? checkout.subscription : null;
    const asaasCustomerId =
      typeof checkout?.customer === 'string' ? checkout.customer : null;

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        asaasSubscriptionId: asaasSubscriptionId ?? local.asaasSubscriptionId,
        asaasCustomerId: asaasCustomerId ?? local.asaasCustomerId,
      },
    });

    await this.reconcileSubscription({
      ...local,
      asaasSubscriptionId: asaasSubscriptionId ?? local.asaasSubscriptionId,
      asaasCustomerId: asaasCustomerId ?? local.asaasCustomerId,
    });
  }

  /**
   * Deriva o estado local (ACTIVE/PAST_DUE/CANCELED) apenas dos dois campos
   * confirmados no spike (`deleted`, `nextDueDate`) — webhook e `/billing/sync`
   * chamam esta mesma funcao, entao os dois caminhos nunca podem divergir.
   */
  private async reconcileSubscription(local: Subscription): Promise<void> {
    if (!local.asaasSubscriptionId) {
      return;
    }

    const remote = await this.asaasClient.getSubscription(local.asaasSubscriptionId);

    if (remote.deleted) {
      await this.prisma.subscription.update({
        where: { id: local.id },
        data: { status: 'CANCELED' },
      });
      return;
    }

    const nextDueDate = new Date(remote.nextDueDate);
    const advanced =
      local.currentPeriodEnd === null || nextDueDate > local.currentPeriodEnd;

    if (advanced) {
      await this.prisma.subscription.update({
        where: { id: local.id },
        data: {
          status: 'ACTIVE',
          currentPeriodEnd: nextDueDate,
          pastDueSince: null,
        },
      });
      return;
    }

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        status: 'PAST_DUE',
        pastDueSince: local.pastDueSince ?? new Date(),
      },
    });
  }
}
