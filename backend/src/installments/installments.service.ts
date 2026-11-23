import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InstallmentPurchase, Prisma } from '@prisma/client';
import { EntitlementsService } from '../billing/entitlements.service';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { lockForCardLink, resolveCardForCreate } from '../credit-cards/card-link';
import { PrismaService } from '../prisma/prisma.service';
import { localToday, utcDate } from '../recurring-transactions/recurrence.util';
import { ConversationWriteRules } from '../recurring-transactions/conversation-write.types';
import { CreateInstallmentPurchaseDto } from './dto/create-installment-purchase.dto';
import { InstallmentMaterializerService } from './installment-materializer.service';
import {
  InstallmentFirstDueChangedError,
  InstallmentWriteReceipt,
  InstallmentWriteUncertainError,
  splitInstallments,
} from './conversation-write.types';

const DESCRIPTION_MIN = 2;
const DESCRIPTION_MAX = 120;

/** Decimal do Prisma vira string no JSON; o front espera numero, mais o progresso ja calculado. */
export function toInstallmentResponse<T extends InstallmentPurchase & { card?: { name: string } | null }>(item: T) {
  // card vira cardName (so acrescenta campo); o objeto nao vai para a resposta.
  const { card, ...rest } = item;
  const totalAmount = Number(item.totalAmount);
  const installmentAmount = Number(item.installmentAmount);
  const paidAmount =
    item.installmentsGenerated >= item.installmentsTotal
      ? totalAmount
      : Math.round(installmentAmount * item.installmentsGenerated * 100) / 100;

  return {
    ...rest,
    cardName: card?.name ?? null,
    totalAmount,
    installmentAmount,
    paidAmount,
    remainingAmount: Math.round((totalAmount - paidAmount) * 100) / 100,
    remainingInstallments: Math.max(item.installmentsTotal - item.installmentsGenerated, 0),
  };
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
export class InstallmentsService {
  private readonly logger = new Logger(InstallmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly materializer: InstallmentMaterializerService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(userId: string) {
    // Traz o calendario em dia antes de mostrar (proxima parcela correta).
    const created = await this.materializer.materializeDue(userId);
    if (created > 0) {
      await this.lifeEngineService.touchUserData(userId);
    }

    const items = await this.prisma.installmentPurchase.findMany({
      where: { userId },
      include: { category: true, card: { select: { name: true } } },
      orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }],
    });

    return items.map(toInstallmentResponse);
  }

  async create(userId: string, dto: CreateInstallmentPurchaseDto) {
    const created = await this.persist(userId, dto);

    // Pós-gravação: falha de materialização ou de atualização não desfaz o cadastro (tela segue 201).
    await this.afterCommit(userId, 'installment.create');

    const fresh = await this.findOwned(userId, created.id);
    return toInstallmentResponse(fresh);
  }

  /** Mesma gravação da tela, para o bot. Devolve só o que foi persistido e as flags pós-commit. */
  async createForConversation(
    userId: string,
    dto: CreateInstallmentPurchaseDto,
    rules: ConversationWriteRules,
  ): Promise<InstallmentWriteReceipt> {
    const created = await this.persist(userId, dto, rules);
    const flags = await this.afterCommit(userId, 'installment.conversation');

    const totalCents = Math.round(Number(created.totalAmount) * 100);
    const installmentCents = Math.round(Number(created.installmentAmount) * 100);
    return {
      id: created.id,
      description: created.description,
      totalCents,
      installmentsTotal: created.installmentsTotal,
      installmentCents,
      lastInstallmentCents: totalCents - installmentCents * (created.installmentsTotal - 1),
      firstDueDate: created.nextDueDate.toISOString().slice(0, 10),
      ...flags,
    };
  }

  /** Núcleo compartilhado com a tela: validação, plano, datas e uma única escrita em transação. */
  private async persist(
    userId: string,
    dto: CreateInstallmentPurchaseDto,
    rules?: ConversationWriteRules,
  ) {
    await this.entitlements.assertCanCreate(userId, 'installmentPurchases');

    const description = typeof dto.description === 'string' ? dto.description.trim() : '';
    if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
      throw new BadRequestException('Informe uma descrição de 2 a 120 caracteres.');
    }
    if (!Number.isFinite(dto.totalAmount) || dto.totalAmount < 0.01 || dto.totalAmount > 9_999_999_999 ||
      new Prisma.Decimal(dto.totalAmount).decimalPlaces() > 2) {
      throw new BadRequestException('Informe um valor total positivo com até duas casas decimais.');
    }
    if (!Number.isInteger(dto.installmentsTotal) || dto.installmentsTotal < 2 || dto.installmentsTotal > 60) {
      throw new BadRequestException('Informe uma quantidade de parcelas de 2 a 60.');
    }

    await this.validateCategory(userId, dto.categoryId);

    // Cada parcela sai igual, exceto a ultima: absorve a sobra do arredondamento (centavos inteiros).
    const totalCents = Math.round(dto.totalAmount * 100);
    const split = splitInstallments(totalCents, dto.installmentsTotal);
    if (split === null) {
      throw new BadRequestException(
        'O valor de cada parcela ficaria abaixo de R$ 0,01. Reduza a quantidade de parcelas ou aumente o valor.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    // Um único relógio para hoje e para as datas desta gravação.
    const today = localToday(new Date(), user?.timezone ?? 'UTC');
    const firstDue = dto.firstDueDate ? parseDateOnly(dto.firstDueDate) : today;

    if (rules?.notBefore === 'today' && firstDue < today) {
      throw new InstallmentFirstDueChangedError(toYmd(today));
    }

    // Mesmo limite das contas fixas: sem historico retroativo em massa, nem vencimento longe demais.
    const earliest = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
    const latest = utcDate(today.getUTCFullYear() + 2, today.getUTCMonth(), today.getUTCDate());

    if (firstDue < earliest) {
      throw new BadRequestException('O vencimento da 1a parcela nao pode ser anterior ao mes passado.');
    }

    if (firstDue > latest) {
      throw new BadRequestException('O vencimento da 1a parcela esta longe demais (maximo 2 anos).');
    }

    let callbackFinished = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Cartao: lock do User antes de ler o cartao (mesma ordem do resto do dominio de cartao).
        await lockForCardLink(tx, userId, dto.cardId);
        const cardId = await resolveCardForCreate(tx, userId, dto.cardId, dto.paymentMethod);
        const row = await tx.installmentPurchase.create({
          data: {
            userId,
            description,
            totalAmount: new Prisma.Decimal(dto.totalAmount),
            installmentAmount: new Prisma.Decimal(split.installmentCents / 100),
            installmentsTotal: dto.installmentsTotal,
            categoryId: dto.categoryId ?? null,
            paymentMethod: dto.paymentMethod ?? null,
            cardId,
            anchorDay: firstDue.getUTCDate(),
            nextDueDate: firstDue,
          },
        });
        callbackFinished = true;
        return row;
      });
    } catch (error) {
      // Callback concluiu e o commit falhou: não dá para afirmar que não gravou.
      if (callbackFinished) throw new InstallmentWriteUncertainError();
      throw error;
    }
  }

  /**
   * Materialização e atualização depois do cadastro. Cada etapa tem a sua falha; o cadastro nunca
   * é desfeito aqui. Só nomes de erro vão para log.
   */
  private async afterCommit(userId: string, operation: string): Promise<{ materializationPending: boolean; refreshPending: boolean }> {
    let materializationPending = false;
    try {
      // Se o vencimento da 1a parcela ja passou (ou e hoje), ela sai agora.
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

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    // As parcelas ja geradas ficam (o vinculo vira null pelo SetNull).
    await this.prisma.installmentPurchase.delete({ where: { id } });
    await this.lifeEngineService.touchUserData(userId);

    return { success: true };
  }

  private async findOwned(userId: string, id: string) {
    const item = await this.prisma.installmentPurchase.findFirst({
      where: { id, userId },
      include: { category: true, card: { select: { name: true } } },
    });

    if (!item) {
      throw new NotFoundException('Compra parcelada nao encontrada.');
    }

    return item;
  }

  private async validateCategory(userId: string, categoryId: string | undefined) {
    if (!categoryId) {
      return;
    }

    const category = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Categoria financeira invalida.');
    }

    if (category.type !== 'EXPENSE') {
      throw new BadRequestException('Compra parcelada so aceita categoria de despesa.');
    }
  }
}
