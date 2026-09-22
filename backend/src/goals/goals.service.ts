import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GoalStatus, NotificationType, Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContributeGoalDto } from './dto/contribute-goal.dto';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { WithdrawGoalDto } from './dto/withdraw-goal.dto';

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly notificationsService: NotificationsService,
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
        recurringAmount:
          dto.recurringAmount !== undefined ? new Prisma.Decimal(dto.recurringAmount) : undefined,
        recurringDay: dto.recurringDay,
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
        recurringAmount:
          dto.recurringAmount === null
            ? null
            : dto.recurringAmount !== undefined
              ? new Prisma.Decimal(dto.recurringAmount)
              : undefined,
        recurringDay: dto.recurringDay === null ? null : dto.recurringDay,
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

    if (nextStatus === GoalStatus.ACHIEVED && goal.status !== GoalStatus.ACHIEVED) {
      await this.notificationsService.createNotification(
        userId,
        NotificationType.SYSTEM,
        'Meta concluída',
        `Parabéns! Você atingiu a meta "${goal.title}".`,
      );
    }

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeGoal(updatedGoal);
  }

  async listContributions(userId: string, id: string) {
    await this.findGoal(userId, id);

    const transactions = await this.prisma.transaction.findMany({
      where: { userId, linkedGoalId: id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, description: true, amount: true, date: true, type: true },
    });

    return transactions.map((t) => ({ ...t, amount: Number(t.amount) }));
  }

  /**
   * Tira dinheiro de volta da meta (o "cofrinho" nao fica so de mao unica).
   * Gera uma transacao INCOME (o dinheiro volta pro saldo livre) — o espelho
   * do TRANSFER que contribute() gera ao guardar.
   */
  async withdraw(userId: string, id: string, dto: WithdrawGoalDto) {
    const goal = await this.findGoal(userId, id);
    const currentAmount = Number(goal.currentAmount);

    if (dto.amount > currentAmount) {
      throw new BadRequestException('Saldo insuficiente nesta meta.');
    }

    const nextCurrentAmount = currentAmount - dto.amount;
    // Um saque pode tirar a meta de "concluida" se ela cair abaixo do alvo de novo.
    const nextStatus =
      goal.status === GoalStatus.ACHIEVED && nextCurrentAmount < Number(goal.targetAmount)
        ? GoalStatus.ACTIVE
        : goal.status;

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
          type: TransactionType.INCOME,
          description: dto.description ?? `Saque da meta ${goal.title}`,
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
      recurringAmount: goal.recurringAmount === null ? null : Number(goal.recurringAmount),
    };
  }
}
