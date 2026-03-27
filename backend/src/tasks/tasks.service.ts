import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async list(userId: string, query: ListTasksQueryDto) {
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        status: query.status,
        priority: query.priority,
        categoryId: query.categoryId,
        title: query.search
          ? {
              contains: query.search,
              mode: 'insensitive',
            }
          : undefined,
        dueDate:
          query.dueFrom || query.dueTo
            ? {
                gte: query.dueFrom ? new Date(query.dueFrom) : undefined,
                lte: query.dueTo ? new Date(query.dueTo) : undefined,
              }
            : undefined,
      },
      include: {
        category: true,
        goal: true,
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    return tasks.map((task) => this.serializeTask(task));
  }

  async get(userId: string, id: string) {
    const task = await this.findTask(userId, id);
    return this.serializeTask(task);
  }

  async create(userId: string, dto: CreateTaskDto) {
    await this.validateRelationships(userId, dto.categoryId, dto.linkedGoalId);

    const task = await this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status ?? TaskStatus.PENDING,
        priority: dto.priority,
        categoryId: dto.categoryId,
        isRecurring: dto.isRecurring ?? false,
        recurrenceRule: dto.recurrenceRule,
        hasFinancialImpact: dto.hasFinancialImpact ?? false,
        estimatedAmount:
          dto.estimatedAmount !== undefined
            ? new Prisma.Decimal(dto.estimatedAmount)
            : undefined,
        linkedGoalId: dto.linkedGoalId,
        completedAt: dto.status === TaskStatus.DONE ? new Date() : null,
        subtasks: dto.subtasks?.length
          ? {
              create: dto.subtasks.map((subtask, index) => ({
                title: subtask.title,
                isCompleted: subtask.isCompleted ?? false,
                completedAt: subtask.isCompleted ? new Date() : null,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        category: true,
        goal: true,
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTask(task);
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    await this.findTask(userId, id);
    await this.validateRelationships(
      userId,
      dto.categoryId === null ? undefined : dto.categoryId,
      dto.linkedGoalId === null ? undefined : dto.linkedGoalId,
    );

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        dueDate:
          dto.dueDate === null
            ? null
            : dto.dueDate
              ? new Date(dto.dueDate)
              : undefined,
        status: dto.status,
        priority: dto.priority,
        categoryId: dto.categoryId === null ? null : dto.categoryId,
        isRecurring: dto.isRecurring,
        recurrenceRule:
          dto.recurrenceRule === null ? null : dto.recurrenceRule,
        hasFinancialImpact: dto.hasFinancialImpact,
        estimatedAmount:
          dto.estimatedAmount === null
            ? null
            : dto.estimatedAmount !== undefined
              ? new Prisma.Decimal(dto.estimatedAmount)
              : undefined,
        linkedGoalId: dto.linkedGoalId === null ? null : dto.linkedGoalId,
        completedAt:
          dto.status === TaskStatus.DONE ? new Date() : dto.status ? null : undefined,
        subtasks: dto.subtasks
          ? {
              deleteMany: {},
              create: dto.subtasks.map((subtask, index) => ({
                title: subtask.title,
                isCompleted: subtask.isCompleted ?? false,
                completedAt: subtask.isCompleted ? new Date() : null,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        category: true,
        goal: true,
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTask(task);
  }

  async remove(userId: string, id: string) {
    await this.findTask(userId, id);
    await this.prisma.task.delete({
      where: { id },
    });

    await this.lifeEngineService.touchUserData(userId);
    return { success: true };
  }

  private async findTask(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
      include: {
        category: true,
        goal: true,
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Tarefa nao encontrada.');
    }

    return task;
  }

  private async validateRelationships(
    userId: string,
    categoryId?: string,
    goalId?: string,
  ) {
    if (categoryId) {
      const category = await this.prisma.taskCategory.findFirst({
        where: { id: categoryId, userId },
      });

      if (!category) {
        throw new NotFoundException('Categoria de tarefa invalida.');
      }
    }

    if (goalId) {
      const goal = await this.prisma.goal.findFirst({
        where: { id: goalId, userId },
      });

      if (!goal) {
        throw new NotFoundException('Meta vinculada nao encontrada.');
      }
    }
  }

  private serializeTask(task: any) {
    return {
      ...task,
      estimatedAmount:
        task.estimatedAmount !== null && task.estimatedAmount !== undefined
          ? Number(task.estimatedAmount)
          : null,
    };
  }
}
