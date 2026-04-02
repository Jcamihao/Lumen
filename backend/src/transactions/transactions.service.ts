import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { endOfMonth, startOfMonth } from 'date-fns';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
  ) {}

  async list(userId: string, query: ListTransactionsQueryDto) {
    const monthStart =
      query.month && query.year
        ? startOfMonth(new Date(query.year, query.month - 1, 1))
        : undefined;
    const monthEnd =
      query.month && query.year
        ? endOfMonth(new Date(query.year, query.month - 1, 1))
        : undefined;

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: query.type,
        categoryId: query.categoryId,
        date: query.dateFrom || query.dateTo || monthStart || monthEnd
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : monthStart,
              lte: query.dateTo ? new Date(query.dateTo) : monthEnd,
            }
          : undefined,
      },
      include: {
        category: true,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    return transactions.map((transaction) => this.serializeTransaction(transaction));
  }

  async create(userId: string, dto: CreateTransactionDto) {
    await this.validateRelationships(
      userId,
      dto.categoryId,
      dto.linkedTaskId,
      dto.linkedGoalId,
      dto.type,
    );

    const transaction = await this.prisma.transaction.create({
      data: {
        userId,
        type: dto.type,
        description: dto.description,
        amount: new Prisma.Decimal(Math.abs(dto.amount)),
        date: new Date(dto.date),
        categoryId: dto.categoryId,
        linkedTaskId: dto.linkedTaskId,
        linkedGoalId: dto.linkedGoalId,
      },
      include: {
        category: true,
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTransaction(transaction);
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    await this.findTransaction(userId, id);
    await this.validateRelationships(
      userId,
      dto.categoryId === null ? undefined : dto.categoryId,
      dto.linkedTaskId === null ? undefined : dto.linkedTaskId,
      dto.linkedGoalId === null ? undefined : dto.linkedGoalId,
      dto.type,
    );

    const transaction = await this.prisma.transaction.update({
      where: { id },
      data: {
        type: dto.type,
        description: dto.description,
        amount:
          dto.amount !== undefined ? new Prisma.Decimal(Math.abs(dto.amount)) : undefined,
        date: dto.date ? new Date(dto.date) : undefined,
        categoryId: dto.categoryId === null ? null : dto.categoryId,
        linkedTaskId: dto.linkedTaskId === null ? null : dto.linkedTaskId,
        linkedGoalId: dto.linkedGoalId === null ? null : dto.linkedGoalId,
      },
      include: {
        category: true,
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTransaction(transaction);
  }

  async remove(userId: string, id: string) {
    await this.findTransaction(userId, id);
    await this.prisma.transaction.delete({
      where: { id },
    });

    await this.lifeEngineService.touchUserData(userId);
    return { success: true };
  }

  private async findTransaction(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!transaction) {
      throw new NotFoundException('Transacao nao encontrada.');
    }

    return transaction;
  }

  private async validateRelationships(
    userId: string,
    categoryId?: string,
    taskId?: string,
    goalId?: string,
    type?: TransactionType,
  ) {
    if (categoryId) {
      const category = await this.prisma.financeCategory.findFirst({
        where: { id: categoryId, userId },
      });

      if (!category) {
        throw new NotFoundException('Categoria financeira invalida.');
      }

      if (type && category.type !== type) {
        throw new NotFoundException(
          'A categoria financeira nao corresponde ao tipo da transacao.',
        );
      }
    }

    if (taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
      });

      if (!task) {
        throw new NotFoundException('Tarefa vinculada nao encontrada.');
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

  private serializeTransaction(transaction: any) {
    return {
      ...transaction,
      amount: Number(transaction.amount),
    };
  }
}
