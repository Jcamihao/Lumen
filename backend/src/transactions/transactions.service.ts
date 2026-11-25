import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { AccessScopeService } from '../access-scope/access-scope.service';
import { isRecordNotFound, lockUserRow } from '../access-scope/lock';
import { ReadScope } from '../access-scope/read-scope';
import { ownSharingFlags, SharingReceipt, toSharingReceipt, withoutSharingMark } from '../access-scope/shared-view';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringMaterializerService } from '../recurring-transactions/recurring-materializer.service';
import { InstallmentMaterializerService } from '../installments/installment-materializer.service';
import {
  findOwnedCardForLink,
  resolveCardForCreateShared,
  resolveCardForUpdateShared,
  withCardGuard,
} from '../credit-cards/card-link';
import { cardScopeWhere } from '../credit-cycle/credit-cycle.util';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { toPartnerTransactionView } from './shared-transaction.view';

const INCLUDE_RELATIONS = {
  category: true,
  envelope: true,
  card: { select: { name: true } },
} as const;

/** Campos que so o autor mexe: cartao, forma de pagamento, tipo e vinculos com dados dele. */
const AUTHOR_ONLY_FIELDS = ['type', 'paymentMethod', 'cardId', 'envelopeId', 'linkedTaskId', 'linkedGoalId'] as const;

const PARTNER_EDIT_RESTRICTED_MESSAGE = 'Quem nao criou o lancamento so altera descricao, valor, data e categoria.';

interface ReachableTransactionRow {
  id: string;
  userId: string;
  sharedGroupOwnerId: string | null;
  type: TransactionType;
  updatedAt: Date;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly recurringMaterializer: RecurringMaterializerService,
    private readonly installmentMaterializer: InstallmentMaterializerService,
    private readonly access: AccessScopeService,
  ) {}

  async list(userId: string, query: ListTransactionsQueryDto) {
    const scope: ReadScope = query.scope ?? 'mine';
    // Cartao alheio ou inexistente: 404 antes de qualquer trabalho (nunca lista vazia que revele existencia).
    const filterCard = query.cardId ? await findOwnedCardForLink(this.prisma, userId, query.cardId) : undefined;

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
        ...(await this.access.scopeWhere(userId, scope)),
        type: query.type,
        categoryId: query.categoryId,
        paymentMethod: query.paymentMethod,
        envelopeId: query.envelopeId,
        // Padrao: inclui CREDIT sem cartao (mesma regra do gasto do ciclo). Sempre AND com userId.
        ...(filterCard ? cardScopeWhere(filterCard) : {}),
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
      include: INCLUDE_RELATIONS,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    return this.presentList(userId, scope, transactions);
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
      const link = await resolveCardForCreateShared(db, this.access, userId, dto.cardId, dto.paymentMethod, dto.type);
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
          cardId: link?.cardId,
          sharedGroupOwnerId: link?.sharedGroupOwnerId ?? undefined,
        },
        include: {
          category: true,
          envelope: true,
          card: { select: { name: true } },
        },
      });
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeOwn(transaction);
  }

  /**
   * Edita o lancamento. Com `expectedUpdatedAt` (usado pela conversa, item 8a) a edicao so vale se o
   * lancamento nao mudou desde aquele instante: a linha e bloqueada com SELECT ... FOR NO KEY UPDATE
   * dentro de uma transacao, relida (id + userId) e comparada, e a mesma regra de validacao e gravacao
   * da tela roda nessa mesma transacao. Sem o parametro, o comportamento e o de sempre.
   *
   * Ordem de locks (unica, para nao gerar deadlock): primeiro a linha do User (quando a edicao mexe em
   * cartao, tipo ou forma de pagamento), depois a linha do lancamento.
   */
  async update(userId: string, id: string, dto: UpdateTransactionDto, expectedUpdatedAt?: Date) {
    const reachable = await this.findReachable(userId, id);
    if (reachable.userId !== userId) {
      return this.updateAsPartner(userId, reachable.userId, id, dto, expectedUpdatedAt);
    }

    // Tipo entra no lock: virar receita limpa o cartao gravado, e isso precisa ser sob o lock.
    const cardLock = dto.cardId !== undefined || dto.paymentMethod !== undefined || dto.type !== undefined;
    const body = async (db: Prisma.TransactionClient | PrismaService) => {
      if (expectedUpdatedAt !== undefined) {
        const rows = await db.$queryRaw<{ updatedAt: Date }[]>`SELECT "updatedAt" FROM "Transaction" WHERE "id" = ${id} AND "userId" = ${userId} FOR NO KEY UPDATE`;
        if (rows.length === 0) {
          throw new NotFoundException('Transacao nao encontrada.');
        }
        if (rows[0].updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new ConflictException('Lancamento alterado desde a leitura.');
        }
      }
      return this.updateRow(db, userId, id, dto);
    };

    const transaction = await (
      cardLock
        ? withCardGuard(this.prisma, userId, true, body)
        : expectedUpdatedAt !== undefined
          ? this.prisma.$transaction(body)
          : body(this.prisma)
    ).catch((error) => {
      // Indice unico (conta fixa + data): mover um lancamento gerado para a
      // data de outro da mesma conta duplicaria aquele vencimento.
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'Ja existe um lancamento desta conta fixa nessa data.',
        );
      }
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Transacao nao encontrada.');
      }

      throw error;
    });

    await this.lifeEngineService.touchUserData(userId);
    return this.serializeOwn(transaction);
  }

  private async updateRow(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ) {
    // Relido sob o lock: a regra de cartao depende do estado atual gravado.
    const current = await this.findTransaction(db, userId, id);
    await this.validateRelationships(
      userId,
      dto.categoryId === null ? undefined : dto.categoryId,
      dto.linkedTaskId === null ? undefined : dto.linkedTaskId,
      dto.linkedGoalId === null ? undefined : dto.linkedGoalId,
      dto.type,
      dto.envelopeId === null ? undefined : dto.envelopeId,
      db,
    );
    const cardPatch = await resolveCardForUpdateShared(db, this.access, userId, current, dto);
    return db.transaction.update({
      where: { id },
      data: {
        type: dto.type,
        description: dto.description,
        amount: dto.amount !== undefined ? new Prisma.Decimal(Math.abs(dto.amount)) : undefined,
        date: dto.date ? new Date(dto.date) : undefined,
        categoryId: dto.categoryId === null ? null : dto.categoryId,
        // undefined = nao mexe; null = limpa.
        paymentMethod: dto.paymentMethod,
        envelopeId: dto.envelopeId === null ? null : dto.envelopeId,
        linkedTaskId: dto.linkedTaskId === null ? null : dto.linkedTaskId,
        linkedGoalId: dto.linkedGoalId === null ? null : dto.linkedGoalId,
        ...cardPatch,
      },
      include: INCLUDE_RELATIONS,
    });
  }

  async remove(userId: string, id: string) {
    const reachable = await this.findReachable(userId, id);
    if (reachable.userId !== userId) {
      return this.removeAsPartner(userId, reachable.userId, id);
    }

    await this.findTransaction(this.prisma, userId, id);
    await this.prisma.transaction
      .delete({
        where: { id },
      })
      .catch((error) => {
        throw isRecordNotFound(error) ? new NotFoundException('Transacao nao encontrada.') : error;
      });

    await this.lifeEngineService.touchUserData(userId);
    return { success: true };
  }

  /**
   * Marca ou desmarca o lancamento como compartilhado (contrato 11b, item 3). So o autor; marcar exige
   * grupo ativo (409 com codigo). Idempotente: sem mudanca, so devolve o recibo do que esta gravado.
   * Trava o User do autor primeiro (ordem unica do contrato 11b, item 6).
   */
  async setSharing(userId: string, id: string, shared: boolean): Promise<SharingReceipt> {
    return this.markSharing(userId, id, shared).catch((error) => {
      throw isRecordNotFound(error) ? new NotFoundException('Transacao nao encontrada.') : error;
    });
  }

  private async markSharing(userId: string, id: string, shared: boolean): Promise<SharingReceipt> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      const item = await tx.transaction.findFirst({
        where: { id, userId },
        select: { id: true, sharedGroupOwnerId: true, updatedAt: true },
      });
      if (!item) {
        throw new NotFoundException('Transacao nao encontrada.');
      }

      const groupOwnerId = shared ? await this.access.requireActiveGroupForSharing(userId, tx) : null;
      if (item.sharedGroupOwnerId === groupOwnerId) {
        return toSharingReceipt(item);
      }
      const updated = await tx.transaction.update({
        where: { id },
        data: { sharedGroupOwnerId: groupOwnerId },
        select: { id: true, sharedGroupOwnerId: true, updatedAt: true },
      });
      return toSharingReceipt(updated);
    });
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

  /** Item visivel para quem le: o proprio item ou um compartilhado por outro membro do grupo (404 igual ao inexistente). */
  private async findReachable(userId: string, id: string): Promise<ReachableTransactionRow> {
    const item = await this.prisma.transaction.findFirst({
      where: { id, OR: [{ userId }, { sharedGroupOwnerId: { not: null } }] },
    });
    if (!item || !(await this.access.canSeeItem(userId, item))) {
      throw new NotFoundException('Transacao nao encontrada.');
    }
    return item;
  }

  /** Edicao por quem nao criou (decisao 3 do contrato 11b): so campos livres, e a categoria precisa ser visivel a ele. */
  private async updateAsPartner(
    readerId: string,
    authorId: string,
    id: string,
    dto: UpdateTransactionDto,
    expectedUpdatedAt?: Date,
  ) {
    this.assertPartnerFields(dto);
    const transaction = await this.prisma
      .$transaction(async (tx) => {
        await lockUserRow(tx, authorId);
        const current = await this.lockReachable(tx, readerId, id);
        if (expectedUpdatedAt !== undefined && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new ConflictException('Lancamento alterado desde a leitura.');
        }
        if (typeof dto.categoryId === 'string') {
          await this.assertCategoryOfAuthorVisible(tx, readerId, authorId, dto.categoryId, current.type);
        }
        return tx.transaction.update({
          where: { id },
          data: {
            description: dto.description,
            amount: dto.amount !== undefined ? new Prisma.Decimal(Math.abs(dto.amount)) : undefined,
            date: dto.date ? new Date(dto.date) : undefined,
            categoryId: dto.categoryId === null ? null : dto.categoryId,
          },
          include: INCLUDE_RELATIONS,
        });
      })
      .catch((error) => {
        if (error?.code === 'P2002') {
          throw new BadRequestException('Ja existe um lancamento desta conta fixa nessa data.');
        }
        throw error;
      });

    await this.lifeEngineService.touchUserData(authorId);
    const names = await this.access.firstNamesById([authorId]);
    return toPartnerTransactionView(transaction, names.get(authorId) ?? null);
  }

  private async removeAsPartner(readerId: string, authorId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, authorId);
      await this.lockReachable(tx, readerId, id);
      await tx.transaction.delete({ where: { id } });
    });

    await this.lifeEngineService.touchUserData(authorId);
    return { success: true };
  }

  /** Trava a linha do lancamento e reconfere a visibilidade sob o lock (quem marcou/saiu antes perde a escrita). */
  private async lockReachable(
    tx: Prisma.TransactionClient,
    readerId: string,
    id: string,
  ): Promise<ReachableTransactionRow> {
    const rows = await tx.$queryRaw<ReachableTransactionRow[]>`
      SELECT "id", "userId", "sharedGroupOwnerId", "type", "updatedAt"
      FROM "Transaction" WHERE "id" = ${id} FOR NO KEY UPDATE`;
    const row = rows[0];
    if (!row || !(await this.access.canSeeItem(readerId, row, tx))) {
      throw new NotFoundException('Transacao nao encontrada.');
    }
    return row;
  }

  /**
   * O parceiro so escolhe categoria que o AUTOR criou e que ele enxerga (compartilhada). Categoria do
   * proprio parceiro nunca entra no lancamento do autor: o autor leria id, orcamento e userId dela.
   */
  private async assertCategoryOfAuthorVisible(
    tx: Prisma.TransactionClient,
    readerId: string,
    authorId: string,
    categoryId: string,
    type: TransactionType,
  ) {
    const scope = await this.access.scopeWhere(readerId, 'shared', tx);
    const category = await tx.financeCategory.findFirst({ where: { id: categoryId, AND: [scope, { userId: authorId }] } });
    if (!category) {
      throw new NotFoundException('Categoria financeira invalida.');
    }
    if (category.type !== type) {
      throw new NotFoundException('A categoria financeira nao corresponde ao tipo da transacao.');
    }
  }

  private assertPartnerFields(dto: UpdateTransactionDto) {
    const touchesAuthorField = AUTHOR_ONLY_FIELDS.some((field) => dto[field] !== undefined);
    if (touchesAuthorField) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'PARTNER_EDIT_RESTRICTED',
        message: PARTNER_EDIT_RESTRICTED_MESSAGE,
      });
    }
  }

  private async presentList(userId: string, scope: ReadScope, transactions: any[]) {
    if (scope === 'mine') {
      return transactions.map((transaction) => this.serializeOwn(transaction));
    }
    const partnerIds = transactions.filter((t) => t.userId !== userId).map((t) => t.userId);
    const names = await this.access.firstNamesById(partnerIds);
    return transactions.map((transaction) =>
      transaction.userId === userId
        ? { ...this.serializeOwn(transaction), ...ownSharingFlags(transaction) }
        : toPartnerTransactionView(transaction, names.get(transaction.userId) ?? null),
    );
  }

  /** cardName vem do include; o objeto card nao vai para a resposta (so acrescenta campos). Sem a marca interna de compartilhamento. */
  private serializeOwn(transaction: any) {
    const { card, sharedGroupOwnerId: _sharingMark, ...rest } = transaction;
    return {
      ...rest,
      category: rest.category ? withoutSharingMark(rest.category) : rest.category,
      amount: Number(transaction.amount),
      cardName: card?.name ?? null,
    };
  }
}
