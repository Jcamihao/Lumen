import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringMaterializerService } from '../recurring-transactions/recurring-materializer.service';
import { InstallmentMaterializerService } from '../installments/installment-materializer.service';
import {
  findOwnedCardForLink,
  resolveCardForCreate,
  resolveCardForUpdate,
  withCardGuard,
} from '../credit-cards/card-link';
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
    // Cartao alheio ou inexistente: 404 antes de qualquer trabalho (nunca lista vazia que revele existencia).
    if (query.cardId) await findOwnedCardForLink(this.prisma, userId, query.cardId);

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
        cardId: query.cardId,
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
        card: { select: { name: true } },
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

    // Cartao so com CREDIT, do proprio usuario e nao arquivado; com cardId a escrita roda sob o lock do User.
    const transaction = await withCardGuard(this.prisma, userId, typeof dto.cardId === 'string', async (db) => {
      const cardId = await resolveCardForCreate(db, userId, dto.cardId, dto.paymentMethod);
      return db.transaction.create({
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
          cardId,
        },
        include: {
          category: true,
          envelope: true,
          card: { select: { name: true } },
        },
      });
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTransaction(transaction);
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    await this.findTransaction(this.prisma, userId, id);
    await this.validateRelationships(
      userId,
      dto.categoryId === null ? undefined : dto.categoryId,
      dto.linkedTaskId === null ? undefined : dto.linkedTaskId,
      dto.linkedGoalId === null ? undefined : dto.linkedGoalId,
      dto.type,
      dto.envelopeId === null ? undefined : dto.envelopeId,
    );

    const cardLock = dto.cardId !== undefined || dto.paymentMethod !== undefined;
    const transaction = await withCardGuard(this.prisma, userId, cardLock, async (db) => {
      // Relido sob o lock: a regra de cartao depende do estado atual gravado.
      const current = await this.findTransaction(db, userId, id);
      const cardPatch = await resolveCardForUpdate(db, userId, current, dto);
      return db.transaction.update({
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
          ...cardPatch,
        },
        include: {
          category: true,
          envelope: true,
          card: { select: { name: true } },
        },
      });
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

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeTransaction(transaction);
  }

  async remove(userId: string, id: string) {
    await this.findTransaction(this.prisma, userId, id);
    await this.prisma.transaction.delete({
      where: { id },
    });

    await this.lifeEngineService.touchUserData(userId);
    return { success: true };
  }

  private async findTransaction(db: Prisma.TransactionClient | PrismaService, userId: string, id: string) {
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

    if (envelopeId) {
      const envelope = await this.prisma.envelope.findFirst({
        where: { id: envelopeId, userId },
        select: { id: true },
      });

      if (!envelope) {
        throw new NotFoundException('Reserva vinculada nao encontrada.');
      }
    }
  }

  /** cardName vem do include; o objeto card nao vai para a resposta (so acrescenta campos). */
  private serializeTransaction(transaction: any) {
    const { card, ...rest } = transaction;
    return {
      ...rest,
      amount: Number(transaction.amount),
      cardName: card?.name ?? null,
    };
  }
}
