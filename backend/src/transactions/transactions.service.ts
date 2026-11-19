import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringMaterializerService } from '../recurring-transactions/recurring-materializer.service';
import { InstallmentMaterializerService } from '../installments/installment-materializer.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly recurringMaterializer: RecurringMaterializerService,
    private readonly installmentMaterializer: InstallmentMaterializerService,
  ) {}

  async list(userId: string, query: ListTransactionsQueryDto) {
    // Contas fixas e parcelas vencidas viram lancamento antes de listar, para a
    // lista (e o saldo) nunca ficarem atras do calendario.
    const recurringCreated = await this.recurringMaterializer.materializeDue(userId);
    const installmentsCreated = await this.installmentMaterializer.materializeDue(userId);
    if (recurringCreated > 0 || installmentsCreated > 0) {
      await this.lifeEngineService.touchUserData(userId);
    }

    // Transacao tem data sem hora, gravada a meia-noite UTC. Os limites do mes
    // precisam ser UTC tambem: com startOfMonth() (fuso do servidor), um
    // lancamento de 01/09 cairia em agosto quando o servidor nao esta em UTC.
    const monthStart =
      query.month && query.year
        ? new Date(Date.UTC(query.year, query.month - 1, 1))
        : undefined;
    const monthEnd =
      query.month && query.year
        ? new Date(Date.UTC(query.year, query.month, 1) - 1)
        : undefined;

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: query.type,
        categoryId: query.categoryId,
        paymentMethod: query.paymentMethod,
        envelopeId: query.envelopeId,
        description: query.search
          ? {
              contains: query.search,
              mode: 'insensitive',
            }
          : undefined,
        date: query.dateFrom || query.dateTo || monthStart || monthEnd
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : monthStart,
              lte: query.dateTo ? new Date(query.dateTo) : monthEnd,
            }
          : undefined,
      },
      include: {
        category: true,
        envelope: true,
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
      dto.envelopeId,
    );

    const transaction = await this.prisma.transaction.create({
      data: {
        userId,
        type: dto.type,
        description: dto.description,
        amount: new Prisma.Decimal(Math.abs(dto.amount)),
        date: new Date(dto.date),
        categoryId: dto.categoryId,
        paymentMethod: dto.paymentMethod,
        envelopeId: dto.envelopeId,
        linkedTaskId: dto.linkedTaskId,
        linkedGoalId: dto.linkedGoalId,
      },
      include: {
        category: true,
        envelope: true,
      },
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTransaction(transaction);
  }

  /**
   * Edita o lancamento. Com `expectedUpdatedAt` (usado pela conversa, item 8a) a edicao so vale se o
   * lancamento nao mudou desde aquele instante: a linha e bloqueada com SELECT ... FOR NO KEY UPDATE
   * dentro de uma transacao, relida (id + userId) e comparada, e a mesma regra de validacao e gravacao
   * da tela roda nessa mesma transacao. Sem o parametro, o comportamento e o de sempre.
   */
  async update(userId: string, id: string, dto: UpdateTransactionDto, expectedUpdatedAt?: Date) {
    if (expectedUpdatedAt === undefined) {
      const transaction = await this.updateRow(this.prisma, userId, id, dto);
      await this.lifeEngineService.touchUserData(userId);
      return this.serializeTransaction(transaction);
    }
    const transaction = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ updatedAt: Date }[]>`SELECT "updatedAt" FROM "Transaction" WHERE "id" = ${id} AND "userId" = ${userId} FOR NO KEY UPDATE`;
      if (rows.length === 0) {
        throw new NotFoundException('Transacao nao encontrada.');
      }
      if (rows[0].updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException('Lancamento alterado desde a leitura.');
      }
      return this.updateRow(tx, userId, id, dto);
    });
    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTransaction(transaction);
  }

  private async updateRow(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ) {
    await this.findTransaction(userId, id, db);
    await this.validateRelationships(
      userId,
      dto.categoryId === null ? undefined : dto.categoryId,
      dto.linkedTaskId === null ? undefined : dto.linkedTaskId,
      dto.linkedGoalId === null ? undefined : dto.linkedGoalId,
      dto.type,
      dto.envelopeId === null ? undefined : dto.envelopeId,
      db,
    );

    return db.transaction
      .update({
        where: { id },
        data: {
          type: dto.type,
          description: dto.description,
          amount:
            dto.amount !== undefined ? new Prisma.Decimal(Math.abs(dto.amount)) : undefined,
          date: dto.date ? new Date(dto.date) : undefined,
          categoryId: dto.categoryId === null ? null : dto.categoryId,
          // undefined = nao mexe; null = limpa.
          paymentMethod: dto.paymentMethod,
          envelopeId: dto.envelopeId === null ? null : dto.envelopeId,
          linkedTaskId: dto.linkedTaskId === null ? null : dto.linkedTaskId,
          linkedGoalId: dto.linkedGoalId === null ? null : dto.linkedGoalId,
        },
        include: {
          category: true,
          envelope: true,
        },
      })
      .catch((error) => {
        // Indice unico (conta fixa + data): mover um lancamento gerado para a
        // data de outro da mesma conta duplicaria aquele vencimento.
        if (error?.code === 'P2002') {
          throw new BadRequestException(
            'Ja existe um lancamento desta conta fixa nessa data.',
          );
        }

        throw error;
      });
  }

  async remove(userId: string, id: string) {
    await this.findTransaction(userId, id);
    await this.prisma.transaction.delete({
      where: { id },
    });

    await this.lifeEngineService.touchUserData(userId);
    return { success: true };
  }

  private async findTransaction(userId: string, id: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const transaction = await db.transaction.findFirst({
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
    envelopeId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (categoryId) {
      const category = await db.financeCategory.findFirst({
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
      const task = await db.task.findFirst({
        where: { id: taskId, userId },
      });

      if (!task) {
        throw new NotFoundException('Tarefa vinculada nao encontrada.');
      }
    }

    if (goalId) {
      const goal = await db.goal.findFirst({
        where: { id: goalId, userId },
      });

      if (!goal) {
        throw new NotFoundException('Meta vinculada nao encontrada.');
      }
    }

    if (envelopeId) {
      const envelope = await db.envelope.findFirst({
        where: { id: envelopeId, userId },
        select: { id: true },
      });

      if (!envelope) {
        throw new NotFoundException('Reserva vinculada nao encontrada.');
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
