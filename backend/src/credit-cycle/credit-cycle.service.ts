import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { localToday } from '../recurring-transactions/recurrence.util';
import { creditCycleBounds } from './credit-cycle.util';
import { SetCreditCycleCeilingDto } from './dto/set-credit-cycle-ceiling.dto';
import { UpdateCreditCycleSettingsDto } from './dto/update-credit-cycle-settings.dto';
import { CreditLimitChangedError, CreditLimitExpectation, CreditLimitWriteReceipt, CreditLimitWriteUncertainError } from './conversation-write.types';

/** Mesmos limiares do orcamento por categoria (insights.service): 80% avisa, 100% estourou. */
export const CREDIT_CYCLE_NEAR_PCT = 80;
export const CREDIT_CYCLE_OVER_PCT = 100;

export type CreditCycleStatus = 'none' | 'ok' | 'near' | 'over';

@Injectable()
export class CreditCycleService {
  private readonly logger = new Logger(CreditCycleService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async getCurrent(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        timezone: true,
        monthClosingDay: true,
        creditDueDay: true,
        creditCycleCountAllPayments: true,
      },
    });

    const closingDay = user.monthClosingDay;
    const { start, end } = creditCycleBounds(localToday(new Date(), user.timezone), closingDay);

    const [ceilingRow, spentAggregate, previousCeilingRow] = await Promise.all([
      this.prisma.creditCycleCeiling.findUnique({
        where: { userId_closingDate: { userId, closingDate: end } },
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId,
          type: TransactionType.EXPENSE,
          date: { gte: start, lte: end },
          ...(user.creditCycleCountAllPayments ? {} : { paymentMethod: 'CREDIT' }),
        },
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
      countAllPayments: user.creditCycleCountAllPayments,
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
      data: {
        creditDueDay: dto.dueDay === undefined ? undefined : dto.dueDay,
        creditCycleCountAllPayments: dto.countAllPayments,
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.getCurrent(userId);
  }

  async setCeiling(userId: string, dto: SetCreditCycleCeilingDto) {
    await this.persistCeiling(userId, dto);
    await this.refreshAfterCeiling(userId);
    return this.getCurrent(userId);
  }

  async setCeilingForConversation(
    userId: string,
    dto: SetCreditCycleCeilingDto,
    expected: CreditLimitExpectation,
  ): Promise<CreditLimitWriteReceipt> {
    const receipt = await this.persistCeiling(userId, dto, expected);
    return { ...receipt, refreshPending: await this.refreshAfterCeiling(userId) };
  }

  /** A tela e o bot serializam seus escritores pelo mesmo dono, inclusive antes de existir teto. */
  private async persistCeiling(userId: string, dto: SetCreditCycleCeilingDto, expected?: CreditLimitExpectation) {
    if (!Number.isFinite(dto.ceiling) || dto.ceiling < 0.01 || dto.ceiling > 9_999_999_999 ||
      new Prisma.Decimal(dto.ceiling).decimalPlaces() > 2) {
      throw new BadRequestException('Informe um limite positivo com até duas casas decimais.');
    }
    let callbackFinished = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { timezone: true, monthClosingDay: true, creditCycleCountAllPayments: true },
        });
        const now = new Date();
        const { start, end } = creditCycleBounds(localToday(now, user.timezone), user.monthClosingDay);
        const current = await tx.creditCycleCeiling.findUnique({
          where: { userId_closingDate: { userId, closingDate: end } },
        });
        const snapshot: CreditLimitExpectation = {
          cycleStart: start.toISOString().slice(0, 10),
          cycleEnd: end.toISOString().slice(0, 10),
          previousCeilingCents: current ? Math.round(Number(current.ceiling) * 100) : null,
          countAllPayments: user.creditCycleCountAllPayments,
        };
        if (expected && (expected.cycleStart !== snapshot.cycleStart || expected.cycleEnd !== snapshot.cycleEnd ||
          expected.previousCeilingCents !== snapshot.previousCeilingCents || expected.countAllPayments !== snapshot.countAllPayments)) {
          throw new CreditLimitChangedError(snapshot);
        }
        const saved = await tx.creditCycleCeiling.upsert({
          where: { userId_closingDate: { userId, closingDate: end } },
          create: { userId, closingDate: end, ceiling: new Prisma.Decimal(dto.ceiling) },
          update: { ceiling: new Prisma.Decimal(dto.ceiling) },
        });
        callbackFinished = true;
        return { id: saved.id, ceilingCents: Math.round(Number(saved.ceiling) * 100), cycleStart: snapshot.cycleStart, cycleEnd: snapshot.cycleEnd };
      });
    } catch (error) {
      if (callbackFinished) throw new CreditLimitWriteUncertainError();
      throw error;
    }
  }

  private async refreshAfterCeiling(userId: string): Promise<boolean> {
    try {
      await this.lifeEngineService.touchUserData(userId);
      return false;
    } catch (error) {
      this.logger.warn({ operation: 'setCeiling.refresh', errorName: error instanceof Error ? error.name : 'Unknown' });
      return true;
    }
  }

  private buildResponse(input: {
    closingDay: number;
    dueDay: number | null;
    countAllPayments: boolean;
    start: Date;
    end: Date;
    ceiling: number | null;
    spent: number;
    previousCeiling: number | null;
  }) {
    const { closingDay, dueDay, countAllPayments, start, end, ceiling, spent, previousCeiling } = input;
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
      countAllPayments,
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
