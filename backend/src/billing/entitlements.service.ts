import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentMonthWindow, pickEffectivePlan } from './access.util';
import { PlanLimitException } from './plan-limit.exception';
import { getPlan, LimitedResource, PlanId } from './plans.catalog';

export interface UsageLine {
  used: number;
  limit: number | null;
}

export interface UsageReport {
  enforced: boolean;
  plan: PlanId;
  resources: Record<LimitedResource, UsageLine>;
  selahQuestions: UsageLine & { resetsAt: string };
}

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  isEnforced(): boolean {
    return this.configService.get<boolean>('app.billingEnabled') === true;
  }

  async resolvePlan(userId: string): Promise<PlanId> {
    // Linhas inteiras (com `source`): concessão não tem tolerância de atraso.
    const subscriptions = await this.prisma.subscription.findMany({
      where: { ownerUserId: userId },
    });
    return pickEffectivePlan(subscriptions, new Date());
  }

  async getUsage(userId: string): Promise<UsageReport> {
    const plan = await this.resolvePlan(userId);
    const definition = getPlan(plan);
    const window = currentMonthWindow(new Date());

    const [goals, envelopes, recurringTransactions, installmentPurchases, selah] =
      await Promise.all([
        this.countResource(userId, 'goals'),
        this.countResource(userId, 'envelopes'),
        this.countResource(userId, 'recurringTransactions'),
        this.countResource(userId, 'installmentPurchases'),
        this.countSelah(userId, window),
      ]);

    return {
      enforced: this.isEnforced(),
      plan,
      resources: {
        goals: { used: goals, limit: definition.limits.goals },
        envelopes: { used: envelopes, limit: definition.limits.envelopes },
        recurringTransactions: {
          used: recurringTransactions,
          limit: definition.limits.recurringTransactions,
        },
        installmentPurchases: {
          used: installmentPurchases,
          limit: definition.limits.installmentPurchases,
        },
      },
      selahQuestions: {
        used: selah,
        limit: definition.selahQuestionsPerMonth,
        resetsAt: window.end.toISOString(),
      },
    };
  }

  /**
   * Bloqueia a criação quando o plano efetivo já atingiu o limite do recurso.
   * Verificar-e-criar não é atômico: sob criações concorrentes o limite pode
   * ser excedido em ±1, o que é aceito.
   */
  async assertCanCreate(userId: string, resource: LimitedResource): Promise<void> {
    if (!this.isEnforced()) return;

    const plan = await this.resolvePlan(userId);
    const limit = getPlan(plan).limits[resource];
    if (limit === null) return;

    const used = await this.countResource(userId, resource);
    if (used >= limit) {
      throw new PlanLimitException({ resource, limit, used, plan });
    }
  }

  async assertCanAskSelah(userId: string): Promise<void> {
    if (!this.isEnforced()) return;

    const plan = await this.resolvePlan(userId);
    const limit = getPlan(plan).selahQuestionsPerMonth;
    if (limit === null) return;

    const used = await this.countSelah(userId, currentMonthWindow(new Date()));
    if (used >= limit) {
      throw new PlanLimitException({
        resource: 'selahQuestions',
        limit,
        used,
        plan,
      });
    }
  }

  async recordSelahQuestion(userId: string): Promise<void> {
    await this.prisma.selahUsage.create({ data: { userId } });
  }

  private countResource(userId: string, resource: LimitedResource): Promise<number> {
    switch (resource) {
      case 'goals':
        return this.prisma.goal.count({
          where: { userId, status: GoalStatus.ACTIVE },
        });
      case 'envelopes':
        return this.prisma.envelope.count({ where: { userId, isActive: true } });
      case 'recurringTransactions':
        return this.prisma.recurringTransaction.count({
          where: { userId, isActive: true },
        });
      case 'installmentPurchases':
        return this.prisma.installmentPurchase.count({
          where: { userId, isActive: true },
        });
    }
  }

  private countSelah(
    userId: string,
    window: { start: Date; end: Date },
  ): Promise<number> {
    return this.prisma.selahUsage.count({
      where: { userId, createdAt: { gte: window.start, lt: window.end } },
    });
  }
}
