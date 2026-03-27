import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinanceCategoryDto } from './dto/create-finance-category.dto';
import { UpdateFinanceCategoryDto } from './dto/update-finance-category.dto';

@Injectable()
export class FinanceCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.financeCategory.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  create(userId: string, dto: CreateFinanceCategoryDto) {
    return this.prisma.financeCategory.create({
      data: {
        userId,
        name: dto.name,
        color: dto.color,
        icon: dto.icon,
        type: dto.type,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateFinanceCategoryDto) {
    await this.ensureOwnership(userId, id);
    return this.prisma.financeCategory.update({
      where: { id },
      data: dto,
    });
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
