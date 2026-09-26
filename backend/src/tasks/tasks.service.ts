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
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTask(task);
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    const existingTask = await this.findTask(userId, id);
    await this.validateRelationships(
      userId,
      dto.categoryId === null ? undefined : dto.categoryId,
      dto.linkedGoalId === null ? undefined : dto.linkedGoalId,
    );

    const isHabitCompletion =
      dto.status === TaskStatus.DONE &&
      existingTask.isRecurring &&
      !!existingTask.recurrenceRule &&
      existingTask.status !== TaskStatus.DONE;

    let streakFields: { streakCount?: number; longestStreak?: number } = {};
    if (isHabitCompletion) {
      const completedAt = new Date();
      const onTime = !existingTask.dueDate || completedAt <= existingTask.dueDate;
      const streakCount = onTime ? existingTask.streakCount + 1 : 1;
      streakFields = {
        streakCount,
        longestStreak: Math.max(existingTask.longestStreak, streakCount),
      };
    }

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
        ...streakFields,
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
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    await this.lifeEngineService.touchUserData(userId);

    // So na transicao pra DONE: concluir de novo (duplo clique, outra aba) nao pode
    // gerar mais uma proxima ocorrencia.
    if (
      dto.status === TaskStatus.DONE &&
      existingTask.status !== TaskStatus.DONE &&
      task.isRecurring &&
      task.recurrenceRule
    ) {
      await this.spawnNextRecurrence(userId, task);
    }

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

  private async spawnNextRecurrence(userId: string, completedTask: any) {
    const nextDueDate = completedTask.dueDate
      ? this.computeNextDueDate(completedTask.dueDate, completedTask.recurrenceRule)
      : null;

    await this.prisma.task.create({
      data: {
        userId,
        title: completedTask.title,
        description: completedTask.description,
        status: TaskStatus.PENDING,
        priority: completedTask.priority,
        categoryId: completedTask.categoryId,
        isRecurring: true,
        recurrenceRule: completedTask.recurrenceRule,
        streakCount: completedTask.streakCount,
        longestStreak: completedTask.longestStreak,
        hasFinancialImpact: completedTask.hasFinancialImpact,
        estimatedAmount: completedTask.estimatedAmount,
        linkedGoalId: completedTask.linkedGoalId,
        dueDate: nextDueDate,
      },
    });
  }

  private computeNextDueDate(from: Date, rule: string): Date {
    const base = new Date(from);
    const r = rule.trim().toLowerCase();

    switch (r) {
      case 'daily':     base.setDate(base.getDate() + 1);           break;
      case 'weekly':    base.setDate(base.getDate() + 7);           break;
      case 'biweekly':  base.setDate(base.getDate() + 14);          break;
      case 'monthly':   base.setMonth(base.getMonth() + 1);         break;
      case 'quarterly': base.setMonth(base.getMonth() + 3);         break;
      case 'yearly':    base.setFullYear(base.getFullYear() + 1);   break;
      default: {
        const m = r.match(/^(\d+)(d|w|m|y)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (m[2] === 'd') base.setDate(base.getDate() + n);
          else if (m[2] === 'w') base.setDate(base.getDate() + n * 7);
          else if (m[2] === 'm') base.setMonth(base.getMonth() + n);
          else if (m[2] === 'y') base.setFullYear(base.getFullYear() + n);
        } else {
          base.setDate(base.getDate() + 7);
        }
      }
    }

    return base;
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
