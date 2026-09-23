import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceCategory, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinanceCategoryDto } from './dto/create-finance-category.dto';
import { UpdateFinanceCategoryDto } from './dto/update-finance-category.dto';

const BUDGET_ONLY_FOR_EXPENSE =
  'Orcamento mensal so vale para categorias de despesa.';

/** Decimal do Prisma serializa como string no JSON; o front espera numero. */
export function toCategoryResponse(category: FinanceCategory) {
  return {
    ...category,
    monthlyBudget:
      category.monthlyBudget === null || category.monthlyBudget === undefined
        ? null
        : Number(category.monthlyBudget),
  };
}

@Injectable()
export class FinanceCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async list(userId: string) {
    const categories = await this.prisma.financeCategory.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    return categories.map(toCategoryResponse);
  }

  async create(userId: string, dto: CreateFinanceCategoryDto) {
    if (typeof dto.monthlyBudget === 'number' && dto.type !== TransactionType.EXPENSE) {
      throw new BadRequestException(BUDGET_ONLY_FOR_EXPENSE);
    }

    const category = await this.prisma.financeCategory
      .create({
        data: {
          userId,
          name: dto.name,
          color: dto.color,
          icon: dto.icon,
          type: dto.type,
          monthlyBudget: dto.monthlyBudget ?? null,
        },
      })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    if (dto.monthlyBudget !== undefined) {
      await this.lifeEngineService.touchUserData(userId);
    }

    return toCategoryResponse(category);
  }

  async update(userId: string, id: string, dto: UpdateFinanceCategoryDto) {
    const existing = await this.ensureOwnership(userId, id);
    const data: UpdateFinanceCategoryDto = { ...dto };

    if ((dto.type ?? existing.type) !== TransactionType.EXPENSE) {
      if (typeof dto.monthlyBudget === 'number') {
        throw new BadRequestException(BUDGET_ONLY_FOR_EXPENSE);
      }
      // Categoria que deixa de ser despesa nao pode ficar com teto orfao.
      if (existing.monthlyBudget !== null) {
        data.monthlyBudget = null;
      }
    }

    const category = await this.prisma.financeCategory
      .update({
        where: { id },
        data,
      })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    // Orcamento novo/alterado/removido muda os alertas: recalcula os insights
    // agora em vez de esperar o proximo ciclo.
    if (data.monthlyBudget !== undefined) {
      await this.lifeEngineService.touchUserData(userId);
    }

    return toCategoryResponse(category);
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    await this.prisma.transaction.updateMany({
      where: { userId, categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.financeCategory.delete({
      where: { id },
    });

    return { success: true };
  }

  /** Indice unico (userId, name, type): mensagem legivel em vez do 500 cru do Prisma. */
  private friendlyDuplicateNameError(error: unknown) {
    if ((error as { code?: string } | null)?.code === 'P2002') {
      return new BadRequestException('Você já tem uma categoria com este nome.');
    }

    return error;
  }

  private async ensureOwnership(userId: string, id: string) {
    const category = await this.prisma.financeCategory.findFirst({
      where: { id, userId },
    });

    if (!category) {
      throw new NotFoundException('Categoria financeira nao encontrada.');
    }

    return category;
  }
}
