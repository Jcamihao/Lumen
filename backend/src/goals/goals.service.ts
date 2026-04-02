import { Injectable, NotFoundException } from '@nestjs/common';
import { GoalStatus, Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContributeGoalDto } from './dto/contribute-goal.dto';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async list(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { targetDate: 'asc' }],
    });

    return goals.map((goal) => this.serializeGoal(goal));
  }

  async create(userId: string, dto: CreateGoalDto) {
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        targetAmount: new Prisma.Decimal(dto.targetAmount),
        currentAmount: new Prisma.Decimal(dto.currentAmount ?? 0),
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        status: dto.status ?? GoalStatus.ACTIVE,
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeGoal(goal);
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    await this.findGoal(userId, id);

    const goal = await this.prisma.goal.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        targetAmount:
          dto.targetAmount !== undefined ? new Prisma.Decimal(dto.targetAmount) : undefined,
        currentAmount:
          dto.currentAmount !== undefined ? new Prisma.Decimal(dto.currentAmount) : undefined,
        targetDate:
          dto.targetDate === null
            ? null
            : dto.targetDate
              ? new Date(dto.targetDate)
              : undefined,
        status: dto.status,
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeGoal(goal);
  }

  async contribute(userId: string, id: string, dto: ContributeGoalDto) {
    const goal = await this.findGoal(userId, id);
    const nextCurrentAmount = Number(goal.currentAmount) + dto.amount;
    const nextStatus =
      nextCurrentAmount >= Number(goal.targetAmount) ? GoalStatus.ACHIEVED : goal.status;

    const updatedGoal = await this.prisma.goal.update({
      where: { id },
      data: {
        currentAmount: new Prisma.Decimal(nextCurrentAmount),
        status: nextStatus,
      },
    });

    if (dto.createTransaction ?? true) {
      await this.prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.TRANSFER,
          description: dto.description ?? `Aporte para a meta ${goal.title}`,
          amount: new Prisma.Decimal(dto.amount),
          date: dto.date ? new Date(dto.date) : new Date(),
          linkedGoalId: goal.id,
        },
      });
    }

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeGoal(updatedGoal);
  }

  async remove(userId: string, id: string) {
    await this.findGoal(userId, id);
    await this.prisma.task.updateMany({
      where: { userId, linkedGoalId: id },
      data: { linkedGoalId: null },
    });
    await this.prisma.transaction.updateMany({
      where: { userId, linkedGoalId: id },
      data: { linkedGoalId: null },
    });
    await this.prisma.goal.delete({
      where: { id },
    });

    await this.lifeEngineService.touchUserData(userId);
    return { success: true };
  }

  private async findGoal(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id, userId },
    });

    if (!goal) {
      throw new NotFoundException('Meta nao encontrada.');
    }

    return goal;
  }

  private serializeGoal(goal: any) {
    return {
      ...goal,
      targetAmount: Number(goal.targetAmount),
      currentAmount: Number(goal.currentAmount),
    };
  }
}
