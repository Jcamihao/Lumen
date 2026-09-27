import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecurringTransaction } from '@prisma/client';
import { EntitlementsService } from '../billing/entitlements.service';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto';
import {
  addDaysUtc,
  firstOccurrenceOnOrAfter,
  localToday,
  utcDate,
} from './recurrence.util';
import { RecurringMaterializerService } from './recurring-materializer.service';

/** Decimal do Prisma vira string no JSON; o front espera numero. */
export function toRecurringResponse<T extends RecurringTransaction>(item: T) {
  return { ...item, amount: Number(item.amount) };
}

/** '2026-10-05' ou '2026-10-05T...' -> meia-noite UTC daquele dia. */
function parseDateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return utcDate(year, month - 1, day);
}

@Injectable()
export class RecurringTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly materializer: RecurringMaterializerService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(userId: string) {
    // Traz o calendario em dia antes de mostrar (proximo vencimento correto).
    const created = await this.materializer.materializeDue(userId);
    if (created > 0) {
      await this.lifeEngineService.touchUserData(userId);
    }

    const items = await this.prisma.recurringTransaction.findMany({
      where: { userId },
      include: { category: true },
      orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }],
    });

    return items.map(toRecurringResponse);
  }

  async create(userId: string, dto: CreateRecurringTransactionDto) {
    await this.entitlements.assertCanCreate(userId, 'recurringTransactions');

    await this.validateCategory(userId, dto.categoryId, dto.type);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const today = localToday(new Date(), user?.timezone ?? 'UTC');
    const firstDue = parseDateOnly(dto.firstDueDate);
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : null;

    // Sem historico retroativo em massa: no maximo desde o mes passado.
    const earliest = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
    const latest = utcDate(today.getUTCFullYear() + 2, today.getUTCMonth(), today.getUTCDate());

    if (firstDue < earliest) {
      throw new BadRequestException(
        'O primeiro vencimento nao pode ser anterior ao mes passado.',
      );
    }

    if (firstDue > latest) {
      throw new BadRequestException('O primeiro vencimento esta longe demais (maximo 2 anos).');
    }

    if (endDate && endDate < firstDue) {
      throw new BadRequestException('A data final nao pode ser anterior ao primeiro vencimento.');
    }

    const created = await this.prisma.recurringTransaction.create({
      data: {
        userId,
        type: dto.type,
        description: dto.description.trim(),
        amount: new Prisma.Decimal(dto.amount),
        categoryId: dto.categoryId ?? null,
        paymentMethod: dto.paymentMethod ?? null,
        frequency: dto.frequency,
        anchorDay: firstDue.getUTCDate(),
        nextDueDate: firstDue,
        endDate,
      },
    });

    // Se o primeiro vencimento ja passou (ou e hoje), o lancamento sai agora.
    await this.materializer.materializeDue(userId);
    await this.lifeEngineService.touchUserData(userId);

    const fresh = await this.findOwned(userId, created.id);
    return toRecurringResponse(fresh);
  }

  async update(userId: string, id: string, dto: UpdateRecurringTransactionDto) {
    const existing = await this.findOwned(userId, id);

    // Retomar uma conta fixa pausada ocupa vaga do plano.
    if (dto.isActive === true && !existing.isActive) {
      await this.entitlements.assertCanCreate(userId, 'recurringTransactions');
    }

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId, existing.type);
    }

    const data: Prisma.RecurringTransactionUncheckedUpdateInput = {};

    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.endDate !== undefined) {
      data.endDate = dto.endDate === null ? null : parseDateOnly(dto.endDate);
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;

      // Retomar nao despeja os meses em que ficou pausada: pula para o proximo
      // vencimento que ainda vem.
      if (dto.isActive && !existing.isActive) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { timezone: true },
        });
        const today = localToday(new Date(), user?.timezone ?? 'UTC');
        data.nextDueDate = firstOccurrenceOnOrAfter(
          existing.nextDueDate,
          today,
          existing.frequency,
          existing.anchorDay,
        );
      }
    }

    const finalEndDate =
      data.endDate === undefined ? existing.endDate : (data.endDate as Date | null);
    const finalNext = (data.nextDueDate as Date | undefined) ?? existing.nextDueDate;

    if (finalEndDate && finalNext > finalEndDate && dto.isActive === true) {
      throw new BadRequestException('A conta ja passou da data final; ajuste ou remova a data final.');
    }

    await this.prisma.recurringTransaction.update({ where: { id }, data });
    await this.lifeEngineService.touchUserData(userId);

    // Retomada com vencimento de hoje ja gera o lancamento de hoje.
    if (dto.isActive === true) {
      await this.materializer.materializeDue(userId);
    }

    return toRecurringResponse(await this.findOwned(userId, id));
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    // Os lancamentos ja gerados ficam (o vinculo vira null pelo SetNull).
    await this.prisma.recurringTransaction.delete({ where: { id } });
    await this.lifeEngineService.touchUserData(userId);

    return { success: true };
  }

  private async findOwned(userId: string, id: string) {
    const item = await this.prisma.recurringTransaction.findFirst({
      where: { id, userId },
      include: { category: true },
    });

    if (!item) {
      throw new NotFoundException('Conta fixa nao encontrada.');
    }

    return item;
  }

  private async validateCategory(
    userId: string,
    categoryId: string | undefined | null,
    type: RecurringTransaction['type'],
  ) {
    if (!categoryId) {
      return;
    }

    const category = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Categoria financeira invalida.');
    }

    if (category.type !== type) {
      throw new BadRequestException('A categoria nao corresponde ao tipo da conta.');
    }
  }
}
