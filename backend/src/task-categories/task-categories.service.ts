import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskCategoryDto } from './dto/create-task-category.dto';
import { UpdateTaskCategoryDto } from './dto/update-task-category.dto';

@Injectable()
export class TaskCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.taskCategory.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  create(userId: string, dto: CreateTaskCategoryDto) {
    return this.prisma.taskCategory.create({
      data: {
        userId,
        name: dto.name,
        color: dto.color,
        icon: dto.icon,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateTaskCategoryDto) {
    await this.ensureOwnership(userId, id);
    return this.prisma.taskCategory.update({
      where: { id },
      data: dto,
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    await this.prisma.task.updateMany({
      where: { userId, categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.taskCategory.delete({
      where: { id },
    });

    return { success: true };
  }

  private async ensureOwnership(userId: string, id: string) {
    const category = await this.prisma.taskCategory.findFirst({
      where: { id, userId },
    });

    if (!category) {
      throw new NotFoundException('Categoria de tarefa nao encontrada.');
    }

    return category;
  }
}
