import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionSource, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickEffectivePlan, subscriptionGrantsAccess } from './access.util';
import { CreateGrantDto } from './dto/create-grant.dto';
import { EntitlementsService, UsageReport } from './entitlements.service';
import {
  getCatalog,
  LimitedResource,
  PlanId,
} from './plans.catalog';

export interface PublicPlan {
  id: PlanId;
  label: string;
  sellable: boolean;
  seats: number;
  limits: Record<LimitedResource, number | null>;
  selahQuestionsPerMonth: number | null;
  prices: { MONTHLY: number; YEARLY: number } | null;
}

export interface BillingMe {
  enabled: boolean;
  plan: PlanId;
  status: SubscriptionStatus | null;
  source: SubscriptionSource | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  latestInvoiceUrl: string | null;
  usage: UsageReport;
}

export interface GrantView {
  id: string;
  email: string;
  name: string;
  plan: 'INDIVIDUAL' | 'SHARED';
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  createdAt: string;
}

interface GrantRow {
  id: string;
  plan: 'INDIVIDUAL' | 'SHARED';
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  owner: { email: string; name: string };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly configService: ConfigService,
  ) {}

  private isEnabled(): boolean {
    return this.configService.get<boolean>('app.billingEnabled') === true;
  }

  getPlans(): { enabled: boolean; plans: PublicPlan[] } {
    const catalog = getCatalog();
    return {
      enabled: this.isEnabled(),
      plans: (['FREE', 'INDIVIDUAL', 'SHARED'] as const).map((id) => {
        const p = catalog[id];
        return {
          id: p.id,
          label: p.label,
          sellable: p.sellable,
          seats: p.seats,
          limits: p.limits,
          selahQuestionsPerMonth: p.selahQuestionsPerMonth,
          prices: p.prices,
        };
      }),
    };
  }

  async getMe(userId: string): Promise<BillingMe> {
    const now = new Date();
    // Linhas inteiras (com `source`): concessão não tem tolerância de atraso.
    const subscriptions = await this.prisma.subscription.findMany({
      where: { ownerUserId: userId },
    });
    const plan = pickEffectivePlan(subscriptions, now);

    // Assinatura que sustenta o plano efetivo (a de maior fim, se houver empate).
    const effective = subscriptions
      .filter((s) => subscriptionGrantsAccess(s, now) && s.plan === plan)
      .sort(
        (a, b) =>
          (b.currentPeriodEnd?.getTime() ?? Infinity) -
          (a.currentPeriodEnd?.getTime() ?? Infinity),
      )[0];

    const usage = await this.entitlements.getUsage(userId);

    return {
      enabled: this.isEnabled(),
      plan,
      status: effective?.status ?? null,
      source: effective?.source ?? null,
      currentPeriodEnd: effective?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: effective?.cancelAtPeriodEnd ?? false,
      latestInvoiceUrl: effective?.latestInvoiceUrl ?? null,
      usage,
    };
  }

  async listGrants(): Promise<GrantView[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { source: 'GRANT' },
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { email: true, name: true } } },
    });
    return rows.map((row) => this.toGrantView(row));
  }

  async createGrant(adminUserId: string, dto: CreateGrantDto): Promise<GrantView> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      throw new NotFoundException('Nenhum usuário encontrado com esse e-mail.');
    }

    const now = new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt.getTime() <= now.getTime()) {
      throw new BadRequestException('A data de fim da concessão deve estar no futuro.');
    }

    const existing = await this.prisma.subscription.findFirst({
      where: {
        ownerUserId: user.id,
        source: 'GRANT',
        plan: dto.plan,
        status: 'ACTIVE',
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
      },
    });
    if (existing) {
      throw new BadRequestException('Esse usuário já tem uma concessão ativa desse plano.');
    }

    const created = await this.prisma.subscription.create({
      data: {
        ownerUserId: user.id,
        plan: dto.plan,
        source: 'GRANT',
        status: 'ACTIVE',
        seats: getCatalog()[dto.plan].seats,
        currentPeriodEnd: endsAt,
        grantedByUserId: adminUserId,
      },
    });
    return this.toGrantView({ ...created, owner: { email: user.email, name: user.name } });
  }

  async revokeGrant(grantId: string): Promise<GrantView> {
    const grant = await this.prisma.subscription.findUnique({
      where: { id: grantId },
      include: { owner: { select: { email: true, name: true } } },
    });
    if (!grant || grant.source !== 'GRANT') {
      throw new NotFoundException('Concessão não encontrada.');
    }
    // Idempotente: já cancelada, devolve como está (não empurra o fim de novo).
    if (grant.status === 'CANCELED') return this.toGrantView(grant);

    const updated = await this.prisma.subscription.update({
      where: { id: grantId },
      data: { status: 'CANCELED', currentPeriodEnd: new Date() },
      include: { owner: { select: { email: true, name: true } } },
    });
    return this.toGrantView(updated);
  }

  private toGrantView(row: GrantRow): GrantView {
    return {
      id: row.id,
      email: row.owner.email,
      name: row.owner.name,
      plan: row.plan,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
