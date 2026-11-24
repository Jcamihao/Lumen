import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { localToday } from '../recurring-transactions/recurrence.util';
import { cardSpendWhere, creditCycleBounds, lockUserForCredit, userCycleFieldsFromCard } from './credit-cycle.util';
import { SetCreditCycleCeilingDto } from './dto/set-credit-cycle-ceiling.dto';
import { UpdateCreditCycleSettingsDto } from './dto/update-credit-cycle-settings.dto';
import { CreditLimitChangedError, CreditLimitExpectation, CreditLimitWriteReceipt, CreditLimitWriteUncertainError } from './conversation-write.types';

/** Mesmos limiares do orcamento por categoria (insights.service): 80% avisa, 100% estourou. */
export const CREDIT_CYCLE_NEAR_PCT = 80;
export const CREDIT_CYCLE_OVER_PCT = 100;

export type CreditCycleStatus = 'none' | 'ok' | 'near' | 'over';

export interface CeilingRemovalReceipt {
  id: string;
  removedCents: number;
  cycleStart: string;
  cycleEnd: string;
  refreshPending: boolean;
}

/** Campos do cartao usados pelo ciclo. */
export const CREDIT_CYCLE_CARD_SELECT = {
  id: true,
  closingDay: true,
  dueDay: true,
  countAllPayments: true,
  isDefault: true,
  archivedAt: true,
} satisfies Prisma.CreditCardSelect;

export type CycleCard = Prisma.CreditCardGetPayload<{ select: typeof CREDIT_CYCLE_CARD_SELECT }>;

type Db = Prisma.TransactionClient;

/** Snapshot visto no rascunho deve bater campo a campo com o lido sob bloqueio (set e remove, 8d). */
function sameCeilingSnapshot(expected: CreditLimitExpectation, snapshot: CreditLimitExpectation): boolean {
  return expected.cycleStart === snapshot.cycleStart && expected.cycleEnd === snapshot.cycleEnd &&
    expected.previousCeilingCents === snapshot.previousCeilingCents && expected.countAllPayments === snapshot.countAllPayments;
}

@Injectable()
export class CreditCycleService {
  private readonly logger = new Logger(CreditCycleService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  /** Ciclo aberto do cartao padrao (mesma resposta de sempre). */
  async getCurrent(userId: string) {
    const card = await this.findDefaultCard(this.prisma, userId);
    return this.getCycleOfCard(userId, card);
  }

  /** Ciclo aberto de um cartao do proprio usuario; cartao alheio responde 404. */
  async getCycleForCard(userId: string, cardId: string) {
    const card = await this.findOwnedCard(this.prisma, userId, cardId);
    return this.getCycleOfCard(userId, card);
  }

  /** Dia de vencimento e contagem de pagamentos vivem no cartao padrao; o User e espelho. */
  async updateSettings(userId: string, dto: UpdateCreditCycleSettingsDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockUserForCredit(tx, userId);
      const card = await this.findDefaultCard(tx, userId);
      const updated = await tx.creditCard.update({
        where: { id: card.id },
        data: {
          dueDay: dto.dueDay === undefined ? undefined : dto.dueDay,
          countAllPayments: dto.countAllPayments,
        },
        select: CREDIT_CYCLE_CARD_SELECT,
      });
      await tx.user.update({
        where: { id: userId },
        data: userCycleFieldsFromCard(updated),
      });
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
    cardId?: string,
  ): Promise<CreditLimitWriteReceipt> {
    const receipt = await this.persistCeiling(userId, dto, expected, cardId);
    return { ...receipt, refreshPending: await this.refreshAfterCeiling(userId) };
  }

  /** Teto de um cartao do usuario (PUT /credit-cards/:id/ceiling). Devolve recibo. */
  async setCeilingForCard(
    userId: string,
    cardId: string,
    dto: SetCreditCycleCeilingDto,
  ): Promise<CreditLimitWriteReceipt> {
    const receipt = await this.persistCeiling(userId, dto, undefined, cardId);
    return { ...receipt, refreshPending: await this.refreshAfterCeiling(userId) };
  }

  /**
   * 8d (D1 do dono): remove o teto do ciclo aberto do cartao, com o MESMO bloqueio e snapshot do set.
   * Sem teto para remover (a tela removeu no meio) ou ciclo/teto diferentes do rascunho: conflito, sem gravar.
   */
  async removeCeilingForConversation(userId: string, expected: CreditLimitExpectation, cardId: string): Promise<CeilingRemovalReceipt> {
    return this.clearCeiling(userId, cardId, expected);
  }

  /** Limpar teto da tela (DELETE /credit-cards/:id/ceiling): mesma regra do bot, sem snapshot do rascunho. */
  async clearCeilingForCard(userId: string, cardId: string): Promise<CeilingRemovalReceipt> {
    return this.clearCeiling(userId, cardId);
  }

  private async clearCeiling(userId: string, cardId: string, expected?: CreditLimitExpectation): Promise<CeilingRemovalReceipt> {
    let callbackFinished = false;
    let removed: Omit<CeilingRemovalReceipt, 'refreshPending'>;
    try {
      removed = await this.prisma.$transaction(async (tx) => {
        await lockUserForCredit(tx, userId);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { timezone: true },
        });
        const card = await this.findOwnedCard(tx, userId, cardId);
        if (card.archivedAt) {
          throw new ConflictException('Cartao arquivado nao tem teto para limpar.');
        }
        const now = new Date();
        const { start, end } = creditCycleBounds(localToday(now, user.timezone), card.closingDay);
        const current = await tx.creditCycleCeiling.findUnique({
          where: { cardId_closingDate: { cardId: card.id, closingDate: end } },
        });
        const snapshot: CreditLimitExpectation = {
          cycleStart: start.toISOString().slice(0, 10),
          cycleEnd: end.toISOString().slice(0, 10),
          previousCeilingCents: current ? Math.round(Number(current.ceiling) * 100) : null,
          countAllPayments: card.countAllPayments,
        };
        if ((expected && !sameCeilingSnapshot(expected, snapshot)) || !current) {
          throw new CreditLimitChangedError(snapshot);
        }
        await tx.creditCycleCeiling.delete({ where: { id: current.id } });
        callbackFinished = true;
        return {
          id: current.id,
          removedCents: snapshot.previousCeilingCents ?? 0,
          cycleStart: snapshot.cycleStart,
          cycleEnd: snapshot.cycleEnd,
        };
      });
    } catch (error) {
      if (callbackFinished) throw new CreditLimitWriteUncertainError();
      throw error;
    }
    return { ...removed, refreshPending: await this.refreshAfterCeiling(userId) };
  }

  /** Cartao padrao ativo. Sem ele e' falha de invariante (migration e cadastro criam um). */
  async findDefaultCard(db: Db, userId: string): Promise<CycleCard> {
    const card = await db.creditCard.findFirst({
      where: { userId, isDefault: true, archivedAt: null },
      select: CREDIT_CYCLE_CARD_SELECT,
    });
    if (!card) {
      this.logger.error({ operation: 'creditCycle.defaultCard', reason: 'missing' });
      throw new InternalServerErrorException('Cartao padrao nao encontrado.');
    }
    return card;
  }

  /** Cartao do usuario ou 404 (nunca 403: nao revela cartao alheio). */
  async findOwnedCard(db: Db, userId: string, cardId: string): Promise<CycleCard & { id: string }> {
    const card = await db.creditCard.findFirst({
      where: { id: cardId, userId },
      select: CREDIT_CYCLE_CARD_SELECT,
    });
    if (!card) throw new NotFoundException('Cartao nao encontrado.');
    return card;
  }

  private async getCycleOfCard(userId: string, card: CycleCard) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });

    const { start, end } = creditCycleBounds(localToday(new Date(), user.timezone), card.closingDay);

    const [ceilingRow, spentAggregate, previousCeilingRow] = await Promise.all([
      this.prisma.creditCycleCeiling.findUnique({
        where: { cardId_closingDate: { cardId: card.id, closingDate: end } },
      }),
      this.prisma.transaction.aggregate({
        where: cardSpendWhere(userId, card, start, end),
        _sum: { amount: true },
      }),
      // Sugestao para o formulario quando ainda nao ha teto definido neste ciclo.
      this.prisma.creditCycleCeiling.findFirst({
        where: { cardId: card.id, closingDate: { lt: end } },
        orderBy: { closingDate: 'desc' },
      }),
    ]);

    const ceiling = ceilingRow ? Number(ceilingRow.ceiling) : null;
    const spent = Number(spentAggregate._sum.amount ?? 0);

    return this.buildResponse({
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      countAllPayments: card.countAllPayments,
      start,
      end,
      ceiling,
      spent,
      previousCeiling: previousCeilingRow ? Number(previousCeilingRow.ceiling) : null,
    });
  }

  /**
   * Grava o teto do ciclo aberto do cartao (padrao quando cardId nao vier).
   * A tela e o bot serializam seus escritores pelo mesmo dono, inclusive antes de existir teto.
   */
  private async persistCeiling(
    userId: string,
    dto: SetCreditCycleCeilingDto,
    expected?: CreditLimitExpectation,
    cardId?: string,
  ) {
    if (!Number.isFinite(dto.ceiling) || dto.ceiling < 0.01 || dto.ceiling > 9_999_999_999 ||
      new Prisma.Decimal(dto.ceiling).decimalPlaces() > 2) {
      throw new BadRequestException('Informe um limite positivo com até duas casas decimais.');
    }
    let callbackFinished = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockUserForCredit(tx, userId);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { timezone: true },
        });
        const card = cardId
          ? await this.findOwnedCard(tx, userId, cardId)
          : await this.findDefaultCard(tx, userId);
        if (card.archivedAt) {
          throw new ConflictException('Cartao arquivado nao recebe teto.');
        }
        const now = new Date();
        const { start, end } = creditCycleBounds(localToday(now, user.timezone), card.closingDay);
        const current = await tx.creditCycleCeiling.findUnique({
          where: { cardId_closingDate: { cardId: card.id, closingDate: end } },
        });
        const snapshot: CreditLimitExpectation = {
          cycleStart: start.toISOString().slice(0, 10),
          cycleEnd: end.toISOString().slice(0, 10),
          previousCeilingCents: current ? Math.round(Number(current.ceiling) * 100) : null,
          countAllPayments: card.countAllPayments,
        };
        if (expected && !sameCeilingSnapshot(expected, snapshot)) {
          throw new CreditLimitChangedError(snapshot);
        }
        const saved = await tx.creditCycleCeiling.upsert({
          where: { cardId_closingDate: { cardId: card.id, closingDate: end } },
          create: { cardId: card.id, userId, closingDate: end, ceiling: new Prisma.Decimal(dto.ceiling) },
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
