import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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
   * Rede de seguranca contra webhook perdido: reconcilia a Subscription ASAAS
   * em aberto do usuario (PENDING/ACTIVE/PAST_DUE — nunca mais de uma ao mesmo
   * tempo, garantido pelo bloqueio do `checkout()`) contra o estado real no
   * Asaas. Sem nada em aberto, nao ha o que sincronizar.
   */
  async sync(userId: string): Promise<void> {
    const local = await this.prisma.subscription.findFirst({
      where: {
        ownerUserId: userId,
        source: 'ASAAS',
        status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!local) {
      return;
    }

    if (!local.asaasSubscriptionId) {
      // Checkout ainda sem `asaasSubscriptionId` gravado: o webhook
      // CHECKOUT_PAID pode ter se perdido. Tenta achar a assinatura no Asaas
      // pelo externalReference (= id desta linha).
      const remote = await this.asaasClient.findSubscriptionByExternalReference(
        local.id,
      );
      if (!remote) {
        return;
      }

      const updated = await this.prisma.subscription.update({
        where: { id: local.id },
        data: { asaasSubscriptionId: remote.id },
      });

      await this.reconcileSubscription(updated);
      return;
    }

    // Ja vinculada: mesmo caminho do webhook, so que puxado pelo usuario.
    await this.reconcileSubscription(local);
  }

  /**
   * Cancela a assinatura ASAAS em cobranca do usuario (ACTIVE/PAST_DUE) ou,
   * se ja cancelada, nao faz nada (idempotente). Sem nenhuma assinatura ASAAS
   * (usuario so Gratis, ou so com concessao GRANT), erro claro em vez de 500
   * ou de mexer numa concessao que nao tem nada a ver com o Asaas.
   */
  async cancel(userId: string): Promise<void> {
    const local = await this.prisma.subscription.findFirst({
      where: {
        ownerUserId: userId,
        source: 'ASAAS',
        status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!local) {
      throw new NotFoundException('Voce nao tem uma assinatura para cancelar.');
    }

    if (local.status === 'CANCELED') {
      return;
    }

    if (local.asaasSubscriptionId) {
      await this.asaasClient.deleteSubscription(local.asaasSubscriptionId);
    }

    // `currentPeriodEnd` nao muda: o acesso segue ate o fim do periodo ja
    // pago (regra ja existente em `access.util.ts`).
    await this.prisma.subscription.update({
      where: { id: local.id },
      data: { status: 'CANCELED', cancelAtPeriodEnd: true },
    });
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
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_OVERDUE':
        await this.handlePaymentStatusEvent(payload);
        break;
      case 'PAYMENT_REFUNDED':
        await this.handlePaymentRefunded(payload);
        break;
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_INACTIVATED':
        await this.handleSubscriptionRemoved(payload);
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
   * PAYMENT_CONFIRMED/PAYMENT_RECEIVED/PAYMENT_OVERDUE: acha a linha local por
   * `asaasSubscriptionId = payload.payment.subscription`, grava `latestInvoiceUrl`
   * quando o payload traz `payment.invoiceUrl` e reconcilia contra o Asaas
   * (mesma funcao usada pelo `CHECKOUT_PAID` e pelo `/billing/sync`).
   */
  private async handlePaymentStatusEvent(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const local = await this.findLocalByPaymentSubscription(payload);
    if (!local) {
      return;
    }

    const invoiceUrl = this.extractInvoiceUrl(payload);
    if (invoiceUrl) {
      await this.prisma.subscription.update({
        where: { id: local.id },
        data: { latestInvoiceUrl: invoiceUrl },
      });
    }

    await this.reconcileSubscription(local);
  }

  /**
   * PAYMENT_REFUNDED: encerra o acesso na hora, sem consultar o Asaas — o
   * reembolso ja aconteceu do lado deles, entao nao ha nada a reconciliar.
   */
  private async handlePaymentRefunded(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const local = await this.findLocalByPaymentSubscription(payload);
    if (!local) {
      return;
    }

    await this.endAccessNow(local);
  }

  /**
   * SUBSCRIPTION_DELETED/SUBSCRIPTION_INACTIVATED: acha a linha local por
   * `asaasSubscriptionId = payload.subscription.id` e reconcilia (o Asaas
   * devolve `deleted:true` nessa consulta, entao vira CANCELED).
   */
  private async handleSubscriptionRemoved(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const subscription = payload.subscription as Record<string, unknown> | undefined;
    const asaasSubscriptionId =
      typeof subscription?.id === 'string' ? subscription.id : undefined;
    if (!asaasSubscriptionId) {
      this.logger.warn('Webhook de assinatura removida sem subscription.id.');
      return;
    }

    const local = await this.prisma.subscription.findFirst({
      where: { asaasSubscriptionId },
    });
    if (!local) {
      this.logger.warn(
        `Webhook de assinatura removida sem Subscription local para ${asaasSubscriptionId}.`,
      );
      return;
    }

    await this.reconcileSubscription(local);
  }

  private async findLocalByPaymentSubscription(
    payload: Record<string, unknown>,
  ): Promise<Subscription | null> {
    const payment = payload.payment as Record<string, unknown> | undefined;
    const asaasSubscriptionId =
      typeof payment?.subscription === 'string' ? payment.subscription : undefined;
    if (!asaasSubscriptionId) {
      this.logger.warn('Webhook de pagamento sem payment.subscription.');
      return null;
    }

    const local = await this.prisma.subscription.findFirst({
      where: { asaasSubscriptionId },
    });
    if (!local) {
      this.logger.warn(
        `Webhook de pagamento sem Subscription local para ${asaasSubscriptionId}.`,
      );
      return null;
    }

    return local;
  }

  private extractInvoiceUrl(payload: Record<string, unknown>): string | undefined {
    const payment = payload.payment as Record<string, unknown> | undefined;
    return typeof payment?.invoiceUrl === 'string' ? payment.invoiceUrl : undefined;
  }

  /** PAYMENT_REFUNDED: encerra o acesso direto, sem tocar no Asaas. */
  private async endAccessNow(local: Subscription): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: local.id },
      data: { status: 'CANCELED', currentPeriodEnd: new Date() },
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
