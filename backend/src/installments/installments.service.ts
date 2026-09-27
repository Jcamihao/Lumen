import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InstallmentPurchase, Prisma } from '@prisma/client';
import { EntitlementsService } from '../billing/entitlements.service';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { localToday, utcDate } from '../recurring-transactions/recurrence.util';
import { CreateInstallmentPurchaseDto } from './dto/create-installment-purchase.dto';
import { InstallmentMaterializerService } from './installment-materializer.service';

/** Decimal do Prisma vira string no JSON; o front espera numero, mais o progresso ja calculado. */
export function toInstallmentResponse<T extends InstallmentPurchase>(item: T) {
  const totalAmount = Number(item.totalAmount);
  const installmentAmount = Number(item.installmentAmount);
  const paidAmount =
    item.installmentsGenerated >= item.installmentsTotal
      ? totalAmount
      : Math.round(installmentAmount * item.installmentsGenerated * 100) / 100;

  return {
    ...item,
    totalAmount,
    installmentAmount,
    paidAmount,
    remainingAmount: Math.round((totalAmount - paidAmount) * 100) / 100,
    remainingInstallments: Math.max(item.installmentsTotal - item.installmentsGenerated, 0),
  };
}

/** '2026-10-05' ou '2026-10-05T...' -> meia-noite UTC daquele dia. */
function parseDateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return utcDate(year, month - 1, day);
}

@Injectable()
export class InstallmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly materializer: InstallmentMaterializerService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(userId: string) {
    // Traz o calendario em dia antes de mostrar (proxima parcela correta).
    const created = await this.materializer.materializeDue(userId);
    if (created > 0) {
      await this.lifeEngineService.touchUserData(userId);
    }

    const items = await this.prisma.installmentPurchase.findMany({
      where: { userId },
      include: { category: true },
      orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }],
    });

    return items.map(toInstallmentResponse);
  }

  async create(userId: string, dto: CreateInstallmentPurchaseDto) {
    await this.entitlements.assertCanCreate(userId, 'installmentPurchases');

    await this.validateCategory(userId, dto.categoryId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const today = localToday(new Date(), user?.timezone ?? 'UTC');
    const firstDue = dto.firstDueDate ? parseDateOnly(dto.firstDueDate) : today;

    // Mesmo limite das contas fixas: sem historico retroativo em massa, nem vencimento longe demais.
    const earliest = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
    const latest = utcDate(today.getUTCFullYear() + 2, today.getUTCMonth(), today.getUTCDate());

    if (firstDue < earliest) {
      throw new BadRequestException('O vencimento da 1a parcela nao pode ser anterior ao mes passado.');
    }

    if (firstDue > latest) {
      throw new BadRequestException('O vencimento da 1a parcela esta longe demais (maximo 2 anos).');
    }

    // Cada parcela sai igual, exceto a ultima: absorve a sobra do arredondamento.
    const installmentAmount = Math.round((dto.totalAmount / dto.installmentsTotal) * 100) / 100;

    const created = await this.prisma.installmentPurchase.create({
      data: {
        userId,
        description: dto.description.trim(),
        totalAmount: new Prisma.Decimal(dto.totalAmount),
        installmentAmount: new Prisma.Decimal(installmentAmount),
        installmentsTotal: dto.installmentsTotal,
        categoryId: dto.categoryId ?? null,
        paymentMethod: dto.paymentMethod ?? null,
        anchorDay: firstDue.getUTCDate(),
        nextDueDate: firstDue,
      },
    });

    // Se o vencimento da 1a parcela ja passou (ou e hoje), ela sai agora.
    await this.materializer.materializeDue(userId);
    await this.lifeEngineService.touchUserData(userId);

    const fresh = await this.findOwned(userId, created.id);
    return toInstallmentResponse(fresh);
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    // As parcelas ja geradas ficam (o vinculo vira null pelo SetNull).
    await this.prisma.installmentPurchase.delete({ where: { id } });
    await this.lifeEngineService.touchUserData(userId);

    return { success: true };
  }

  private async findOwned(userId: string, id: string) {
    const item = await this.prisma.installmentPurchase.findFirst({
      where: { id, userId },
      include: { category: true },
    });

    if (!item) {
      throw new NotFoundException('Compra parcelada nao encontrada.');
    }

    return item;
  }

  private async validateCategory(userId: string, categoryId: string | undefined) {
    if (!categoryId) {
      return;
    }

    const category = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Categoria financeira invalida.');
    }

    if (category.type !== 'EXPENSE') {
      throw new BadRequestException('Compra parcelada so aceita categoria de despesa.');
    }
  }
}
