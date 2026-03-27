import { Injectable, NotFoundException } from '@nestjs/common';
import { ReminderStatus } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async list(userId: string) {
    return this.prisma.reminder.findMany({
      where: { userId },
      include: {
        task: true,
        transaction: true,
        goal: true,
      },
      orderBy: { remindAt: 'asc' },
    });
  }

  async create(userId: string, dto: CreateReminderDto) {
    await this.validateRelationships(userId, dto.taskId, dto.transactionId, dto.goalId);

    const reminder = await this.prisma.reminder.create({
      data: {
        userId,
        title: dto.title,
        remindAt: new Date(dto.remindAt),
        taskId: dto.taskId,
        transactionId: dto.transactionId,
        goalId: dto.goalId,
      },
      include: {
        task: true,
        transaction: true,
        goal: true,
      },
    });

    await this.lifeEngineService.scheduleReminder(reminder.id, reminder.remindAt);
    await this.lifeEngineService.invalidateDashboard(userId);
    return reminder;
  }

  async update(userId: string, id: string, dto: UpdateReminderDto) {
    await this.findReminder(userId, id);
    await this.validateRelationships(
      userId,
      dto.taskId === null ? undefined : dto.taskId,
      dto.transactionId === null ? undefined : dto.transactionId,
      dto.goalId === null ? undefined : dto.goalId,
    );

    const reminder = await this.prisma.reminder.update({
      where: { id },
      data: {
        title: dto.title,
        remindAt: dto.remindAt ? new Date(dto.remindAt) : undefined,
        taskId: dto.taskId === null ? null : dto.taskId,
        transactionId: dto.transactionId === null ? null : dto.transactionId,
        goalId: dto.goalId === null ? null : dto.goalId,
        status: ReminderStatus.SCHEDULED,
        sentAt: null,
      },
      include: {
        task: true,
        transaction: true,
        goal: true,
      },
    });

    await this.lifeEngineService.scheduleReminder(reminder.id, reminder.remindAt);
    await this.lifeEngineService.invalidateDashboard(userId);
    return reminder;
  }

  async remove(userId: string, id: string) {
    await this.findReminder(userId, id);
    await this.prisma.reminder.delete({
      where: { id },
    });

    await this.lifeEngineService.invalidateDashboard(userId);
    return { success: true };
  }

  private async findReminder(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId },
    });

    if (!reminder) {
      throw new NotFoundException('Lembrete nao encontrado.');
    }

    return reminder;
  }

  private async validateRelationships(
    userId: string,
    taskId?: string,
    transactionId?: string,
    goalId?: string,
  ) {
    if (taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
      });

      if (!task) {
        throw new NotFoundException('Tarefa vinculada nao encontrada.');
      }
    }

    if (transactionId) {
      const transaction = await this.prisma.transaction.findFirst({
        where: { id: transactionId, userId },
      });

      if (!transaction) {
        throw new NotFoundException('Transacao vinculada nao encontrada.');
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
}
