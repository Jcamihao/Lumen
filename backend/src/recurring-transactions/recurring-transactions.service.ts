import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RecurrenceFrequency, RecurringTransaction } from '@prisma/client';
import { EntitlementsService } from '../billing/entitlements.service';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { lockForCardLink, resolveCardForCreate, resolveCardForUpdate, withCardGuard } from '../credit-cards/card-link';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto';
import {
  addDaysUtc,
  firstOccurrenceOnOrAfter,
  localToday,
  utcDate,
} from './recurrence.util';
import { RecurringMaterializerService } from './recurring-materializer.service';
import {
  ConversationWriteRules,
  RecurringFirstDueChangedError,
  RecurringWriteReceipt,
  RecurringWriteUncertainError,
} from './conversation-write.types';

const DESCRIPTION_MIN = 2;
const DESCRIPTION_MAX = 120;

/** Decimal do Prisma vira string no JSON; o front espera numero. */
export function toRecurringResponse<T extends RecurringTransaction & { card?: { name: string } | null }>(item: T) {
  // card vira cardName (so acrescenta campo); o objeto nao vai para a resposta.
  const { card, ...rest } = item;
  return { ...rest, amount: Number(item.amount), cardName: card?.name ?? null };
}

/** '2026-10-05' ou '2026-10-05T...' -> meia-noite UTC daquele dia. */
function parseDateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return utcDate(year, month - 1, day);
}

/** Data-só UTC como 'AAAA-MM-DD'. */
function toYmd(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Só o nome do erro vai para log: nunca mensagem, valor ou descrição. */
function errorName(error: unknown) {
  return error instanceof Error ? error.name : 'Unknown';
}

@Injectable()
export class RecurringTransactionsService {
  private readonly logger = new Logger(RecurringTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly materializer: RecurringMaterializerService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(userId: string) {
    // Traz o calendario em dia antes de mostrar (proximo vencimento correto).
    const created = await this.materializer.materializeDue(userId);
    if (created > 0) {
      await this.lifeEngineService.touchUserData(userId);
    }

    const items = await this.prisma.recurringTransaction.findMany({
      where: { userId },
      include: { category: true, card: { select: { name: true } } },
      orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }],
    });

    return items.map(toRecurringResponse);
  }

  async create(userId: string, dto: CreateRecurringTransactionDto) {
    const created = await this.persist(userId, dto);

    // Pós-gravação: falha de materialização ou de atualização não desfaz o cadastro (tela segue 201).
    await this.afterCommit(userId, 'recurring.create');

    const fresh = await this.findOwned(userId, created.id);
    return toRecurringResponse(fresh);
  }

  /** Mesma gravação da tela, para o bot. Devolve só o que foi persistido e as flags pós-commit. */
  async createForConversation(
    userId: string,
    dto: CreateRecurringTransactionDto,
    rules: ConversationWriteRules,
  ): Promise<RecurringWriteReceipt> {
    const created = await this.persist(userId, dto, rules);
    const flags = await this.afterCommit(userId, 'recurring.conversation');

    return {
      id: created.id,
      description: created.description,
      amountCents: Math.round(Number(created.amount) * 100),
      frequency: created.frequency,
      firstDueDate: created.nextDueDate.toISOString().slice(0, 10),
      ...flags,
    };
  }

  /** Núcleo compartilhado com a tela: validação, plano, datas e uma única escrita em transação. */
  private async persist(
    userId: string,
    dto: CreateRecurringTransactionDto,
    rules?: ConversationWriteRules,
  ) {
    await this.entitlements.assertCanCreate(userId, 'recurringTransactions');

    const description = typeof dto.description === 'string' ? dto.description.trim() : '';
    if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
      throw new BadRequestException('Informe uma descrição de 2 a 120 caracteres.');
    }
    if (!Number.isFinite(dto.amount) || dto.amount < 0.01 || dto.amount > 9_999_999_999 ||
      new Prisma.Decimal(dto.amount).decimalPlaces() > 2) {
      throw new BadRequestException('Informe um valor positivo com até duas casas decimais.');
    }
    if (!(Object.values(RecurrenceFrequency) as string[]).includes(dto.frequency)) {
      throw new BadRequestException('Frequência inválida.');
    }

    await this.validateCategory(userId, dto.categoryId, dto.type);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    // Um único relógio para hoje e para as datas desta gravação.
    const today = localToday(new Date(), user?.timezone ?? 'UTC');
    const firstDue = parseDateOnly(dto.firstDueDate);
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : null;

    if (rules?.notBefore === 'today' && firstDue < today) {
      throw new RecurringFirstDueChangedError(toYmd(today));
    }

    // Sem historico retroativo em massa: no maximo desde o mes passado.
    const earliest = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
    const latest = utcDate(today.getUTCFullYear() + 2, today.getUTCMonth(), today.getUTCDate());

    if (firstDue < earliest) {
      throw new BadRequestException(
        'O primeiro vencimento nao pode ser anterior ao mes passado.',
      );
    }

    if (firstDue > latest) {
      throw new BadRequestException('O primeiro vencimento esta longe demais (maximo 2 anos).');
    }

    if (endDate && endDate < firstDue) {
      throw new BadRequestException('A data final nao pode ser anterior ao primeiro vencimento.');
    }

    let callbackFinished = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Cartao: lock do User antes de ler o cartao (mesma ordem do resto do dominio de cartao).
        await lockForCardLink(tx, userId, dto.cardId);
        const cardId = await resolveCardForCreate(tx, userId, dto.cardId, dto.paymentMethod, dto.type);
        const row = await tx.recurringTransaction.create({
          data: {
            userId,
            type: dto.type,
            description,
            amount: new Prisma.Decimal(dto.amount),
            categoryId: dto.categoryId ?? null,
            paymentMethod: dto.paymentMethod ?? null,
            cardId,
            frequency: dto.frequency,
            anchorDay: firstDue.getUTCDate(),
            nextDueDate: firstDue,
            endDate,
          },
        });
        callbackFinished = true;
        return row;
      });
    } catch (error) {
      // Callback concluiu e o commit falhou: não dá para afirmar que não gravou.
      if (callbackFinished) throw new RecurringWriteUncertainError();
      throw error;
    }
  }

  /**
   * Materialização e atualização dos dados derivados depois do cadastro. Cada etapa tem a sua falha:
   * o cadastro já existe e nunca é desfeito por aqui. Só nomes de erro são registrados.
   */
  private async afterCommit(userId: string, operation: string): Promise<{ materializationPending: boolean; refreshPending: boolean }> {
    let materializationPending = false;
    try {
      // Se o primeiro vencimento ja passou (ou e hoje), o lancamento sai agora.
      await this.materializer.materializeDue(userId);
    } catch (error) {
      materializationPending = true;
      this.logger.warn({ operation: `${operation}.materialize`, errorName: errorName(error) });
    }
    let refreshPending = false;
    try {
      await this.lifeEngineService.touchUserData(userId);
    } catch (error) {
      refreshPending = true;
      this.logger.warn({ operation: `${operation}.refresh`, errorName: errorName(error) });
    }
    return { materializationPending, refreshPending };
  }

  async update(userId: string, id: string, dto: UpdateRecurringTransactionDto) {
    const existing = await this.findOwned(userId, id);

    // Retomar uma conta fixa pausada ocupa vaga do plano.
    if (dto.isActive === true && !existing.isActive) {
      await this.entitlements.assertCanCreate(userId, 'recurringTransactions');
    }

    if (dto.categoryId) {
      await this.validateCategory(userId, dto.categoryId, existing.type);
    }

    const data: Prisma.RecurringTransactionUncheckedUpdateInput = {};

    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.endDate !== undefined) {
      data.endDate = dto.endDate === null ? null : parseDateOnly(dto.endDate);
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;

      // Retomar nao despeja os meses em que ficou pausada: pula para o proximo
      // vencimento que ainda vem.
      if (dto.isActive && !existing.isActive) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { timezone: true },
        });
        const today = localToday(new Date(), user?.timezone ?? 'UTC');
        data.nextDueDate = firstOccurrenceOnOrAfter(
          existing.nextDueDate,
          today,
          existing.frequency,
          existing.anchorDay,
        );
      }
    }

    const finalEndDate =
      data.endDate === undefined ? existing.endDate : (data.endDate as Date | null);
    const finalNext = (data.nextDueDate as Date | undefined) ?? existing.nextDueDate;

    if (finalEndDate && finalNext > finalEndDate && dto.isActive === true) {
      throw new BadRequestException('A conta ja passou da data final; ajuste ou remova a data final.');
    }

    // Cartao: com cardId o update roda sob o lock do User e relê o estado gravado.
    const cardLock = dto.cardId !== undefined || dto.paymentMethod !== undefined;
    await withCardGuard(this.prisma, userId, cardLock, async (db) => {
      // Relido sob o lock quando a regra de cartao depende do estado gravado.
      const current = cardLock
        ? await db.recurringTransaction.findFirst({
            where: { id, userId },
            select: { cardId: true, paymentMethod: true, type: true },
          })
        : existing;
      if (!current) throw new NotFoundException('Conta fixa nao encontrada.');
      const cardPatch = await resolveCardForUpdate(db, userId, current, dto);
      await db.recurringTransaction.update({ where: { id }, data: { ...data, ...cardPatch } });
    });
    await this.lifeEngineService.touchUserData(userId);

    // Retomada com vencimento de hoje ja gera o lancamento de hoje.
    if (dto.isActive === true) {
      await this.materializer.materializeDue(userId);
    }

    return toRecurringResponse(await this.findOwned(userId, id));
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    // Os lancamentos ja gerados ficam (o vinculo vira null pelo SetNull).
    await this.prisma.recurringTransaction.delete({ where: { id } });
    await this.lifeEngineService.touchUserData(userId);

    return { success: true };
  }

  private async findOwned(userId: string, id: string) {
    const item = await this.prisma.recurringTransaction.findFirst({
      where: { id, userId },
      include: { category: true, card: { select: { name: true } } },
    });

    if (!item) {
      throw new NotFoundException('Conta fixa nao encontrada.');
    }

    return item;
  }

  private async validateCategory(
    userId: string,
    categoryId: string | undefined | null,
    type: RecurringTransaction['type'],
  ) {
    if (!categoryId) {
      return;
    }

    const category = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Categoria financeira invalida.');
    }

    if (category.type !== type) {
      throw new BadRequestException('A categoria nao corresponde ao tipo da conta.');
    }
  }
}
