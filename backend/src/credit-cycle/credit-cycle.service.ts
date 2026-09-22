import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { localToday } from '../recurring-transactions/recurrence.util';
import { creditCycleBounds } from './credit-cycle.util';
import { SetCreditCycleCeilingDto } from './dto/set-credit-cycle-ceiling.dto';
import { UpdateCreditCycleSettingsDto } from './dto/update-credit-cycle-settings.dto';

/** Mesmos limiares do orcamento por categoria (insights.service): 80% avisa, 100% estourou. */
export const CREDIT_CYCLE_NEAR_PCT = 80;
export const CREDIT_CYCLE_OVER_PCT = 100;

export type CreditCycleStatus = 'none' | 'ok' | 'near' | 'over';

@Injectable()
export class CreditCycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async getCurrent(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true, monthClosingDay: true, creditDueDay: true },
    });

    const closingDay = user.monthClosingDay;
    const { start, end } = creditCycleBounds(localToday(new Date(), user.timezone), closingDay);

    const [ceilingRow, spentAggregate, previousCeilingRow] = await Promise.all([
      this.prisma.creditCycleCeiling.findUnique({
        where: { userId_closingDate: { userId, closingDate: end } },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: TransactionType.EXPENSE, paymentMethod: 'CREDIT', date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      // Sugestao para o formulario quando ainda nao ha teto definido neste ciclo.
      this.prisma.creditCycleCeiling.findFirst({
        where: { userId, closingDate: { lt: end } },
        orderBy: { closingDate: 'desc' },
      }),
    ]);

    const ceiling = ceilingRow ? Number(ceilingRow.ceiling) : null;
    const spent = Number(spentAggregate._sum.amount ?? 0);

    return this.buildResponse({
      closingDay,
      dueDay: user.creditDueDay,
      start,
      end,
      ceiling,
      spent,
      previousCeiling: previousCeilingRow ? Number(previousCeilingRow.ceiling) : null,
    });
  }

  async updateSettings(userId: string, dto: UpdateCreditCycleSettingsDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { creditDueDay: dto.dueDay === undefined ? undefined : dto.dueDay },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.getCurrent(userId);
  }

  async setCeiling(userId: string, dto: SetCreditCycleCeilingDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true, monthClosingDay: true },
    });
    const { end } = creditCycleBounds(localToday(new Date(), user.timezone), user.monthClosingDay);

    await this.prisma.creditCycleCeiling.upsert({
      where: { userId_closingDate: { userId, closingDate: end } },
      create: { userId, closingDate: end, ceiling: new Prisma.Decimal(dto.ceiling) },
      update: { ceiling: new Prisma.Decimal(dto.ceiling) },
    });

    // Teto novo/alterado muda os alertas: recalcula os insights agora em vez
    // de esperar o proximo ciclo do pulso (mesmo padrao do orcamento por categoria).
    await this.lifeEngineService.touchUserData(userId);
    return this.getCurrent(userId);
  }

  private buildResponse(input: {
    closingDay: number;
    dueDay: number | null;
    start: Date;
    end: Date;
    ceiling: number | null;
    spent: number;
    previousCeiling: number | null;
  }) {
    const { closingDay, dueDay, start, end, ceiling, spent, previousCeiling } = input;
    const percentUsed = ceiling ? Math.floor((spent / ceiling) * 100) : null;
    const remaining = ceiling !== null ? ceiling - spent : null;

    let status: CreditCycleStatus = 'none';
    if (ceiling !== null) {
      status =
        (percentUsed ?? 0) >= CREDIT_CYCLE_OVER_PCT
          ? 'over'
          : (percentUsed ?? 0) >= CREDIT_CYCLE_NEAR_PCT
            ? 'near'
            : 'ok';
    }

    return {
      closingDay,
      dueDay,
      cycleStart: start.toISOString(),
      cycleEnd: end.toISOString(),
      ceiling,
      spent,
      remaining,
      percentUsed,
      status,
      previousCeiling,
    };
  }
}
