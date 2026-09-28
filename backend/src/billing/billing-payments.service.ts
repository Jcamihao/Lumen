import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient } from './asaas-client';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { getCatalog, PLAN_RANK } from './plans.catalog';

// Mesma janela usada no checkout `RECURRENT` do Asaas (Global Constraints do plano):
// depois disso o checkout expira do lado deles e nao pode mais ser reaproveitado.
const CHECKOUT_MINUTES_TO_EXPIRE = 60;

@Injectable()
export class BillingPaymentsService {
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
}
